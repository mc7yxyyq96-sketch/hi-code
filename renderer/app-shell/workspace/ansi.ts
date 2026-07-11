export interface AnsiSegment {
  text: string;
  className: string;
}

const COLOR_CLASS: Record<number, string> = {
  30: "c-gray", 90: "c-gray", 31: "c-red", 91: "c-red",
  32: "c-green", 92: "c-green", 33: "c-yellow", 93: "c-yellow",
  34: "c-blue", 94: "c-blue", 35: "c-magenta", 95: "c-magenta",
  36: "c-cyan", 96: "c-cyan",
};

export function parseAnsiSegments(value: string): AnsiSegment[] {
  const source = String(value || "");
  const segments: AnsiSegment[] = [];
  let bold = false;
  let color = "";
  let cursor = 0;
  let textStart = 0;

  const className = () => [bold ? "c-bold" : "", color].filter(Boolean).join(" ");
  const push = (text: string) => {
    if (!text) return;
    const currentClass = className();
    const previous = segments[segments.length - 1];
    if (previous?.className === currentClass) previous.text += text;
    else segments.push({ text, className: currentClass });
  };

  while (cursor < source.length) {
    if (source[cursor] !== "\u001b" || source[cursor + 1] !== "[") {
      cursor += 1;
      continue;
    }
    const match = /^\u001b\[([0-9;]*)m/.exec(source.slice(cursor));
    if (!match) {
      cursor += 1;
      continue;
    }
    push(source.slice(textStart, cursor));
    const codes = match[1].split(";").filter(Boolean).map(Number);
    if (!codes.length) codes.push(0);
    for (const code of codes) {
      if (code === 0) { bold = false; color = ""; }
      else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = "";
      else if (COLOR_CLASS[code]) color = COLOR_CLASS[code];
    }
    cursor += match[0].length;
    textStart = cursor;
  }
  push(source.slice(textStart));
  return segments.length ? segments : [{ text: "", className: "" }];
}
