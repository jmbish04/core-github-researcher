import { Agent, callable } from 'agents';
import OpenAI from 'openai';
import { Agent as OpenAIAgent, OpenAIResponsesModel, setDefaultOpenAIKey } from '@openai/agents';

type OpenAIEnv = Cloudflare.Env;

/**
 * Create an OpenAI Agents SDK agent instance configured with the OpenAI API key.
 */
const createOpenAIClientAgent = (apiKey: string) => {
  setDefaultOpenAIKey(apiKey);
  const client = new OpenAI({ apiKey });
  return new OpenAIAgent({
    name: 'code-research-openai-agent',
    model: new OpenAIResponsesModel(client, 'gpt-4.1-mini'),
    instructions: 'Provide concise assistance for code research.',
    handoffDescription: 'OpenAI agent for code research tasks.',
  });
};

/**
 * Cloudflare Agents SDK wrapper that hosts an OpenAI Agents SDK agent instance.
 */
export class CodeResearchAgent extends Agent<OpenAIEnv> {
  private openaiAgent = createOpenAIClientAgent(this.env.OPENAI_API_KEY);

  /**
   * Returns a basic status payload for the agent instance.
   */
  @callable({
    description: 'Return the agent name and model identifier.',
  })
  async getStatus() {
    return {
      name: this.name,
      model: 'openai',
    };
  }
}
