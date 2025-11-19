import "dotenv/config";
import OpenAI from "openai";
import { MODEL } from "./model.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

async function main() {
  // Using 'as any' for params to adapt user's Chat-like structure to Responses API
  // Based on API error message, use 'text.format' instead of 'response_format'.
  const res = await client.responses.create({
    model: MODEL,
    instructions:
      "You are a diagnostic helper. Set declared_model to the exact identifier of the model you are currently running as (e.g. 'gpt-5.1').",
    input: [
      {
        role: "user",
        content: "Return JSON only.",
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "model_check",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            declared_model: { type: "string" },
            note: { type: "string", nullable: true },
          },
          required: ["declared_model", "note"],
        },
      },
    },
  } as any); // casting as any because types might be out of sync

  const outputItem = res.output?.[0] as any;
  const text = outputItem?.content?.[0]?.text || (res as any).output_text;

  console.log("\n=== MODEL CHECK RESULT ===");
  console.log(text);
}

main().catch((err) => {
  console.error("Model check failed:", err);
  process.exit(1);
});
