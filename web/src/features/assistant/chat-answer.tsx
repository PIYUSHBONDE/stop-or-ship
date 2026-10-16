import { Fragment } from 'react';

// Render only the formatting we support. Everything else stays escaped text.
function inline(text: string) {
  return text
    .split(/(\*\*[^*\n]+\*\*)/g)
    .map((part, index) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    );
}

export function ChatAnswer({ text, id }: { text: string; id: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      blocks.push({ list: false, lines: [] });
      continue;
    }
    const list = /^\s*[-*]\s+/.test(line);
    const last = blocks.at(-1);
    const value = list ? line.replace(/^\s*[-*]\s+/, '') : line;
    if (last && last.list === list && last.lines.length) last.lines.push(value);
    else blocks.push({ list, lines: [value] });
  }
  return (
    <div id={id}>
      {blocks
        .filter((block) => block.lines.length)
        .map((block, index) =>
          block.list ? (
            <ul key={index}>
              {block.lines.map((line, item) => (
                <li key={item}>{inline(line)}</li>
              ))}
            </ul>
          ) : (
            <p key={index}>{inline(block.lines.join('\n'))}</p>
          ),
        )}
    </div>
  );
}
