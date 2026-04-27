export interface Recipient {
  name: string;
  email: string;
  [key: string]: any;
}

export interface FieldMapping {
  column: string;
  x: number;
  y: number;
  fontSize: number;
  canvasX: number;
  canvasY: number;
}

export interface SMTPConfig {
  host: string;
  port: string;
  user: string;
  pass: string;
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface Progress {
  current: number;
  total: number;
  sent: number;
  errors: number;
}
