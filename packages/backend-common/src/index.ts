import { Hono } from "hono";
import { evlog, type EvlogVariables } from "evlog/hono";
import { initLogger } from "evlog";
import nodemailer from "nodemailer";
import { ZodError, z } from "zod";

const initState = new Set<string>();

export const baseServiceEnvSchema = z.object({
  APP_NAME: z.string().min(1).default("app"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RUN_MIGRATIONS_ON_BOOT: z.coerce.boolean().default(true),
});

export type BaseServiceEnv = z.infer<typeof baseServiceEnvSchema>;

export const mailEnvSchema = z.object({
  MAIL_TRANSPORT: z.enum(["log", "smtp"]).default("smtp"),
  MAIL_FROM: z.string().email().default("noreply@devboxes.local"),
  MAIL_HOST: z.string().min(1).default("127.0.0.1"),
  MAIL_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_SECURE: z.coerce.boolean().default(false),
  MAIL_USER: z.string().min(1).optional(),
  MAIL_PASSWORD: z.string().min(1).optional(),
});

export type MailEnv = z.infer<typeof mailEnvSchema>;

export type MailMessage = {
  html?: string;
  metadata?: Record<string, unknown>;
  subject: string;
  text: string;
  to: string;
};

export type MailTransport = {
  send(message: MailMessage): Promise<void>;
};

export function readServiceEnv<TSchema extends z.ZodRawShape>(extension: z.ZodObject<TSchema>) {
  return baseServiceEnvSchema.merge(extension).parse(process.env);
}

export function readMailEnv() {
  return mailEnvSchema.parse(process.env);
}

function ensureLoggerInitialized(service: string) {
  if (initState.has(service)) {
    return;
  }

  initLogger({
    env: { service },
  });
  initState.add(service);
}

export function createBackendApp(service: string, readinessCheck?: () => Promise<boolean>) {
  ensureLoggerInitialized(service);

  const app = new Hono<EvlogVariables>();
  app.use(evlog());

  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      service,
    }),
  );

  app.get("/readyz", async (c) => {
    if (!readinessCheck) {
      return c.json({ ok: true, service });
    }

    const ready = await readinessCheck();
    return c.json(
      {
        ok: ready,
        service,
      },
      ready ? 200 : 503,
    );
  });

  app.onError((error, c) => {
    c.get("log")?.error(error, { service });

    if (error instanceof ZodError) {
      return c.json(
        {
          error: "validation_failed",
          issues: error.issues,
        },
        400,
      );
    }

    return c.json(
      {
        error: "internal_error",
        message: error.message,
      },
      500,
    );
  });

  return app;
}

export function createMailTransport(env = readMailEnv()): MailTransport {
  if (env.MAIL_TRANSPORT === "smtp") {
    const transport = nodemailer.createTransport({
      auth:
        env.MAIL_USER && env.MAIL_PASSWORD
          ? {
              pass: env.MAIL_PASSWORD,
              user: env.MAIL_USER,
            }
          : undefined,
      host: env.MAIL_HOST,
      port: env.MAIL_PORT,
      secure: env.MAIL_SECURE,
    });

    return {
      async send(message) {
        await transport.sendMail({
          from: env.MAIL_FROM,
          html: message.html,
          subject: message.subject,
          text: message.text,
          to: message.to,
        });
      },
    };
  }

  return {
    async send(message) {
      console.info(
        `[mail:${env.MAIL_TRANSPORT}] ${JSON.stringify({
          from: env.MAIL_FROM,
          ...message,
        })}`,
      );
    },
  };
}
