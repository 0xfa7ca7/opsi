import { sanitizeTerminalText } from "@klopsi/output";

export interface Presentation {
  title(value: string): string;
  heading(value: string): string;
  success(value: string): string;
  command(value: string): string;
  muted(value: string): string;
  sanitize(value: unknown): string;
}

export interface PresentationOptions {
  readonly color: boolean;
}

export function createPresentation(options: PresentationOptions): Presentation {
  const style = (open: string, value: string): string =>
    options.color ? `${open}${value}\u001b[0m` : value;
  const sanitize = (value: unknown): string => sanitizeTerminalText(value);

  return {
    title: (value) => style("\u001b[1;36m", sanitize(value)),
    heading: (value) => style("\u001b[1m", sanitize(value)),
    success: (value) => style("\u001b[1;32m", sanitize(value)),
    command: (value) => style("\u001b[36m", sanitize(value)),
    muted: (value) => style("\u001b[2m", sanitize(value)),
    sanitize,
  };
}
