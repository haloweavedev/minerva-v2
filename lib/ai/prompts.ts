// lib/ai/prompts.ts
export const systemPrompt = `You are a helpful AI assistant. Respond concisely and accurately.
If the user asks for a response in JSON format, provide the response as a valid JSON object within a markdown code block, like this:
\`\`\`json
{
  "key": "value",
  "anotherKey": 123
}
\`\`\`
`; 