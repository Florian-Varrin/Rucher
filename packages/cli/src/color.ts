import { styleText } from 'node:util';
import type { Io } from './io.ts';

type Style = Parameters<typeof styleText>[0];

export interface Paint {
  bold: (text: string) => string;
  dim: (text: string) => string;
  yellow: (text: string) => string;
  red: (text: string) => string;
  cyan: (text: string) => string;
}

export function paint(io: Pick<Io, 'color'>): Paint {
  const style = (name: Style) => (text: string) =>
    io.color ? styleText(name, text, { validateStream: false }) : text;
  return {
    bold: style('bold'),
    dim: style('dim'),
    yellow: style('yellow'),
    red: style('red'),
    cyan: style('cyan'),
  };
}
