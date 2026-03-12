GPT OSS 20B
openai/gpt-oss-20b

Try it in Playground
TOKEN SPEED
~1000 tps
Powered by
groq
INPUT
Text
OUTPUT
Text
CAPABILITIES
Tool Use, Browser Search, Code Execution, JSON Object Mode, JSON Schema Mode, Reasoning
OpenAI logo
OpenAI
Model card
OpenAI's compact open-weight Mixture-of-Experts (MoE) model with 20B total parameters. Optimized for cost-efficient deployment and agentic workflows, it supports long-context reasoning, tool use, and function calling in a small memory footprint.

PRICING
Input
$0.075
13M / $1
Cached Input
$0.037
27M / $1
Output
$0.30
3.3M / $1
LIMITS
CONTEXT WINDOW
131,072
MAX OUTPUT TOKENS
65,536
QUANTIZATION
This uses Groq's TruePoint Numerics, which reduces precision only in areas that don't affect accuracy, preserving quality while delivering significant speedup over traditional approaches. Learn more here.
Key Technical Specifications
Model Architecture
Built on a Mixture-of-Experts (MoE) architecture with 20B total parameters (3.6B active per forward pass). Features 24 layers with 32 MoE experts using Top-4 routing per token. Equipped with Grouped Query Attention (8 K/V heads, 64 Q heads) with rotary embeddings and RMSNorm pre-layer normalization.
Performance Metrics
The GPT-OSS 20B model demonstrates exceptional performance across key benchmarks:
MMLU (General Reasoning): 85.3%
SWE-Bench Verified (Coding): 60.7%
AIME 2025 (Math with tools): 98.7%
MMMLU (Multilingual): 75.7% average
Use Cases
Low-Latency Agentic Applications
Ideal for cost-efficient deployment in agentic workflows with advanced tool calling capabilities including web browsing, Python execution, and function calling.
Affordable Reasoning & Coding
Provides strong performance in coding, reasoning, and multilingual tasks while maintaining a small memory footprint for budget-conscious deployments.
Tool-Augmented Applications
Excels at applications requiring browser integration, Python code execution, and structured function calling with variable reasoning modes.
Long-Context Processing
Supports up to 131K context length for processing large documents and maintaining conversation history in complex workflows.
Best Practices
Utilize variable reasoning modes (low, medium, high) to balance performance and latency based on your specific use case requirements.
Provide clear, detailed tool and function definitions with explicit parameters, expected outputs, and constraints for optimal tool use performance.
Structure complex tasks into clear steps to leverage the model's agentic reasoning capabilities effectively.
Use the full 128K context window for complex, multi-step workflows and comprehensive documentation analysis.
Leverage the model's multilingual capabilities by clearly specifying the target language and cultural context when needed.
Get Started with GPT-OSS 20B
Experience openai/gpt-oss-20b on Groq:

curl
JavaScript
Python
JSON
shell

npm install groq-sdk
JavaScript

import Groq from "groq-sdk";
const groq = new Groq();
async function main() {
  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "user",
        content: "Explain why fast inference is critical for reasoning models",
      },
    ],
  });
  console.log(completion.choices[0]?.message?.content);
}
main().catch(console.error);