#!/usr/bin/env python3
"""
Local Llama 3.2-1B financial analyst.

Runs the downloaded Hugging Face model with transformers and serves two modes:

  one-shot:   python llm/analyst.py --model llama3.2-1b --prompt "..." [--max-tokens 220]
  server:     python llm/analyst.py --model llama3.2-1b --server

Server mode keeps the model resident and reads JSON request lines from stdin:

  {"messages": [{"role":"system","content":"..."}, {"role":"user","content":"..."}],
   "max_tokens": 220}

and writes one JSON result line per request to stdout:

  {"text": "...", "tokens": 42, "elapsed_s": 8.1}
"""
import argparse
import json
import sys
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# Keep stdout clean for the JSON protocol (progress bars go to stderr).
import logging
logging.getLogger("transformers").setLevel(logging.ERROR)
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)


DEFAULT_MODEL = "llama3.2-1b"
SYSTEM_PROMPT = (
    "You are a quantitative market analyst. Analyze the provided market data "
    "objectively and concisely. Base every claim strictly on the numbers in the "
    "snapshot. Clearly separate factual observations (the actual numbers) from "
    "your interpretation. Acknowledge uncertainty where data is limited. You do "
    "not give personalized financial advice; where relevant, end with a short "
    "disclaimer."
)


def load(model_dir):
    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        model_dir, dtype=torch.float32, low_cpu_mem_usage=True
    )
    model.eval()
    return tokenizer, model


def generate(tokenizer, model, messages, max_tokens=220):
    prompt = tokenizer.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=True,
        return_tensors="pt", return_dict=False,
    )
    with torch.no_grad():
        out = model.generate(
            prompt,
            max_new_tokens=max_tokens,
            temperature=0.3,
            top_p=0.9,
            repetition_penalty=1.1,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )
    return tokenizer.decode(out[0][prompt.shape[1]:], skip_special_tokens=True).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--server", action="store_true")
    parser.add_argument("--prompt", default=None)
    parser.add_argument("--system", default=SYSTEM_PROMPT)
    parser.add_argument("--max-tokens", type=int, default=220)
    args = parser.parse_args()

    tokenizer, model = load(args.model)

    def handle(messages, max_tokens):
        t0 = time.time()
        text = generate(tokenizer, model, messages, max_tokens)
        result = {
            "text": text,
            "tokens": len(text.split()),
            "elapsed_s": round(time.time() - t0, 2),
        }
        return result

    if args.server:
        print(json.dumps({"status": "ready", "model": args.model}), flush=True)
        for line in sys.stdin:
            try:
                req = json.loads(line)
                messages = req.get("messages")
                if not messages:
                    print(json.dumps({"error": "messages required"}), flush=True)
                    continue
                result = handle(messages, req.get("max_tokens", args.max_tokens))
                print(json.dumps(result), flush=True)
            except Exception as exc:  # keep the server alive across bad inputs
                print(json.dumps({"error": str(exc)}), flush=True)
    else:
        if not args.prompt:
            parser.error("--prompt is required unless --server is used")
        messages = [
            {"role": "system", "content": args.system},
            {"role": "user", "content": args.prompt},
        ]
        print(json.dumps(handle(messages, args.max_tokens)))


if __name__ == "__main__":
    main()
