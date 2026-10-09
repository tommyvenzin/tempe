// Scans Source/OrderCheck.cs for syntax newer than C# 5 and unbalanced brackets.
// (The RDP PC compiles with csc /langversion:5; there is no compiler here.)
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "Source", "OrderCheck.cs"), "utf8");
// Strip comments, strings and chars so they can't trigger false matches.
let code = "", i = 0;
while (i < src.length) {
  const c = src[i], n = src[i + 1];
  if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
  if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2) + 2; continue; }
  if (c === "@" && n === '"') { i += 2; while (i < src.length) { if (src[i] === '"' && src[i + 1] === '"') { i += 2; continue; } if (src[i] === '"') break; i++; } i++; code += '""'; continue; }
  if (c === '"') { i++; while (i < src.length && src[i] !== '"') { if (src[i] === "\\") i++; i++; } i++; code += '""'; continue; }
  if (c === "'") { i++; while (i < src.length && src[i] !== "'") { if (src[i] === "\\") i++; i++; } i++; code += "' '"; continue; }
  code += c; i++;
}
const banned = [
  [/\$"/, "string interpolation"], [/\?\./, "null-conditional ?."], [/\?\[/, "null-conditional ?["],
  [/\bnameof\s*\(/, "nameof"], [/\bout\s+var\b/, "out var"], [/=>/, "lambda or expression-bodied member (use delegate { })"],
  [/\bcatch\s*\([^)]*\)\s*when\b/, "exception filter"], [/\{\s*get;\s*(set;\s*)?\}\s*=/, "auto-property initializer"],
  [/\bis\s+var\b/, "pattern matching"], [/\bdefault\s*[;,)]/, "default literal"], [/\(\s*\w+\s+\w+\s*,\s*\w+\s+\w+\s*\)\s*\w+\s*=/, "tuple"],
  [/\busing\s+static\b/, "using static"], [/\?\?=/, "??="], [/\bthrow\b[^;]*\?\?/, "throw expression"],
];
const problems = banned.filter(([re]) => re.test(code)).map(([, what]) => what);
const pairs = { "(": ")", "[": "]", "{": "}" }, stack = [];
for (const ch of code) {
  if (pairs[ch]) stack.push(pairs[ch]);
  else if (")]}".includes(ch)) { if (stack.pop() !== ch) { problems.push("unbalanced " + ch); break; } }
}
if (stack.length) problems.push("unclosed brackets: " + stack.length);
if (problems.length) { console.error("FAIL C# 5 check: " + problems.join(", ")); process.exit(1); }
console.log(`PASS C# 5 syntax scan and bracket balance (${src.split("\n").length} lines).`);
