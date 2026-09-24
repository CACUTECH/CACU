import {genkit} from 'genkit';
import {openAI} from 'genkitx-openai';

export const ai = genkit({
  plugins: [openAI()],
  model: 'openai/gpt-4o',
});
