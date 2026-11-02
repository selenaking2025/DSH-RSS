import ts from 'typescript';

export function bridgeContract(source) {
  const file = ts.createSourceFile('rss.ts', source, ts.ScriptTarget.Latest, true);
  const alias = file.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'RssBridge');
  if (!alias || !ts.isTypeLiteralNode(alias.type)) throw new Error('无法解析 Catpaw RssBridge；请检查接口变化。');
  const printer = ts.createPrinter({ removeComments: true });
  return Object.fromEntries(alias.type.members.map(member => {
    if (!ts.isPropertySignature(member) || !member.name || !member.type) throw new Error('未知 RssBridge 接口声明。');
    return [member.name.getText(file), printer.printNode(ts.EmitHint.Unspecified, member.type, file).replace(/\s+/g, ' ').trim()];
  }));
}

export function contractChanges(before, after) {
  return {
    added: Object.keys(after).filter(name => !(name in before)),
    removed: Object.keys(before).filter(name => !(name in after)),
    changed: Object.keys(after).filter(name => name in before && before[name] !== after[name]),
  };
}
