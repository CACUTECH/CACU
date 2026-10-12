import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config({ path: '.env' });
const apiKey = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_MODEL?.trim();
if (!apiKey || !model || apiKey.startsWith('replace-') || model.startsWith('replace-')) {
  console.error('Set OPENAI_API_KEY and OPENAI_MODEL in .env. Do not paste secrets into chat.');
  process.exitCode = 1;
} else if (!process.argv.includes('--live')) {
  console.log('OpenAI configuration found. No API request made. Run npm run ai:check -- --live for a billable synthetic connection test.');
} else {
  try {
    const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', timeout: 20000, maxRetries: 0, logLevel: 'off' });
    const response = await client.responses.create({ model, store: false, max_output_tokens: 1000,
      input: 'This is a synthetic CACU connection test. Reply only: Connection verified.' });
    if (response.status !== 'completed' || !response.output_text?.trim()) throw new Error('No complete text');
    console.log('OpenAI connection verified. No business records were sent.');
  } catch {
    console.error('OpenAI connection test failed. Check project API access, model, billing and network.');
    process.exitCode = 1;
  }
}
