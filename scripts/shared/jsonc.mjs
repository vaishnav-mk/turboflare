export function stripJsonComments(value) {
  let output = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];

    if (!inString && character === "/" && next === "/") {
      while (index < value.length && value[index] !== "\n") {
        index += 1;
      }
      output += value[index] ?? "";
      continue;
    }

    output += character;
    if (escaping) {
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
    }
  }

  return stripTrailingCommas(output);
}

function stripTrailingCommas(value) {
  let output = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaping) {
      output += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      output += character;
      escaping = true;
      continue;
    }

    if (character === '"') {
      output += character;
      inString = !inString;
      continue;
    }

    if (!inString && character === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(value[nextIndex] ?? "")) {
        nextIndex += 1;
      }
      if (value[nextIndex] === "}" || value[nextIndex] === "]") {
        continue;
      }
    }

    output += character;
  }

  return output;
}

export function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}
