import { z } from 'zod';

export const EnvSchema = z.object({
    // =======================
    // Server Configuration
    // =======================
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // =======================
    // AI Configuration
    // =======================
    OPENROUTER_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_DEFAULT_MODEL_ID: z.string().default('x-ai/grok-4.1-fast'),
    OLLAMA_BASE_URL: z.string().optional(),
    OLLAMA_MODEL: z.string().default('qwen2.5'),
    AI_DATAGOV_MODEL_ID: z.string().default('google/gemini-2.5-flash-lite'),
    AI_CBS_MODEL_ID: z.string().default('google/gemini-2.5-flash-lite'),
    AI_ENABLE_SCORERS: z.preprocess((val) => val === 'true' || val === '1', z.boolean()).default(false),
    AI_MAX_STEPS: z.coerce.number().int().min(1).default(25),
    AI_TOOL_CALL_CONCURRENCY: z.coerce.number().int().min(1).default(10),

    // =======================
    // Convex Configuration
    // =======================
    NEXT_PUBLIC_CONVEX_URL: z.string().optional(),
    CONVEX_ADMIN_KEY: z.string().optional(),

    // =======================
    // Deployment / Metadata
    // =======================
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),
    NEXT_PUBLIC_SITE_URL: z.string().default('https://data-israel.org'),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
    // Skip validation on the client — server-only secrets like
    // OPENROUTER_API_KEY are not available in the browser bundle.
    if (typeof window !== 'undefined') {
        return process.env as unknown as Env;
    }

    const { data, error } = EnvSchema.safeParse(process.env);

    if (error) {
        console.error('Environment validation failed:', error.issues);
        throw new Error(error.issues[0].message);
    }

    return data;
}

export const ENV = parseEnv();
