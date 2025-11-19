export const MODEL = "gpt-5.1" as const;
export const MODEL_MINI = "gpt-5.1-mini" as const;

export type GPT5Model = typeof MODEL | typeof MODEL_MINI;

/**
 * Type guard that validates the model string.
 * Throws an error if the model is not one of the allowed GPT-5.1 models.
 * 
 * @param model - The model string to validate
 * @returns The validated model string
 * @throws Error if the model is invalid
 */
export function validateModel(model: string): GPT5Model {
  if (model !== MODEL && model !== MODEL_MINI) {
    throw new Error(
      `Invalid model: ${model}. Only '${MODEL}' or '${MODEL_MINI}' are allowed.`
    );
  }
  return model as GPT5Model;
}
