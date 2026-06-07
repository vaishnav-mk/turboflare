export function redactTokens(value, tokens) {
  let output = value;
  for (const token of tokens) {
    if (token !== undefined && token.length > 0) {
      output = output.replaceAll(token, "<redacted>");
    }
  }
  return output;
}
