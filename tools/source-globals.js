"use strict";

const fs = require("fs");
const path = require("path");
const espree = require("espree");

function addPatternNames(pattern, names) {
  if (!pattern) return;
  if (pattern.type === "Identifier") {
    names.add(pattern.name);
    return;
  }
  if (pattern.type === "RestElement") {
    addPatternNames(pattern.argument, names);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    addPatternNames(pattern.left, names);
    return;
  }
  if (pattern.type === "ArrayPattern") {
    pattern.elements.forEach((element) => addPatternNames(element, names));
    return;
  }
  if (pattern.type === "ObjectPattern") {
    pattern.properties.forEach((property) => {
      addPatternNames(property.type === "RestElement" ? property.argument : property.value, names);
    });
  }
}

function assignedGlobalName(statement) {
  if (!statement || statement.type !== "ExpressionStatement") return "";
  const expression = statement.expression;
  if (!expression || expression.type !== "AssignmentExpression" || expression.operator !== "=") return "";
  const left = expression.left;
  if (!left || left.type !== "MemberExpression" || left.computed || left.property.type !== "Identifier") return "";
  if (left.object.type !== "Identifier" || !["window", "globalThis"].includes(left.object.name)) return "";
  return left.property.name;
}

function collectTopLevelGlobals(source) {
  const program = espree.parse(source, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowHashBang: true
  });
  const names = new Set();
  for (const statement of program.body) {
    if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id) {
      names.add(statement.id.name);
    } else if (statement.type === "VariableDeclaration") {
      statement.declarations.forEach((declaration) => addPatternNames(declaration.id, names));
    }
    const assigned = assignedGlobalName(statement);
    if (assigned) names.add(assigned);
  }
  return names;
}

function collectScriptGlobals(root, files) {
  const byFile = new Map();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, "src/js", file), "utf8");
    byFile.set(file, collectTopLevelGlobals(source));
  }
  return byFile;
}

module.exports = { collectTopLevelGlobals, collectScriptGlobals };
