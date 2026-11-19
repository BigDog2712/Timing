import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measureSource, physicalLines } from './size-measure.mjs';

const eff = (text, ext) => measureSource(text, ext).effective;

describe('measureSource — 基础口径', () => {
  it('整行注释与空行都不计入有效行', () => {
    const text = ['// a', '', 'const x = 1;', '   ', '// b'].join('\n');
    assert.equal(eff(text, '.ts'), 1);
    assert.equal(physicalLines(text), 5);
  });

  it('行尾注释所在行仍算代码行', () => {
    const text = ['const x = 1; // 注释', '/* 一段 */ const y = 2;'].join('\n');
    assert.equal(eff(text, '.ts'), 2);
  });

  it('纯块注释跨行时整段都不计入', () => {
    const text = ['/*', ' * 说明', ' */', 'let a = 1;'].join('\n');
    assert.equal(eff(text, '.rs'), 1);
  });

  it('CRLF 与末尾无换行都能正确计数', () => {
    assert.equal(measureSource('// a\r\nconst x = 1;', '.ts').effective, 1);
    assert.equal(measureSource('const x = 1;', '.ts').raw, 1);
    assert.equal(measureSource('', '.ts').raw, 0);
  });
});

describe('measureSource — Rust 词法边界', () => {
  it('块注释可嵌套（Rust 特有）', () => {
    const text = ['/* 外层 /* 内层 */', '仍是注释', '*/', 'fn f() {}'].join('\n');
    assert.equal(eff(text, '.rs'), 1);
  });

  it('raw string 里的注释符号是代码', () => {
    const text = ['let s = r#"// 不是注释 /* 也不是 */"#;', 'let t = r"/* 同样 */";'].join('\n');
    assert.equal(eff(text, '.rs'), 2);
  });

  it('raw string 可跨行且不吞后续代码', () => {
    const text = ['let s = r#"', '// 在字符串里', '"#;', 'let x = 1;'].join('\n');
    assert.equal(eff(text, '.rs'), 4);
  });

  it('多行 SQL 字符串的内容行算代码行', () => {
    const text = [
      'let q = sqlx::query_as(',
      '    r#"',
      '    SELECT package_name',
      '      FROM app_usage',
      '     WHERE local_date = ?1',
      '    "#,',
      ');',
    ].join('\n');
    assert.equal(eff(text, '.rs'), 7);
  });

  it('生命周期不是字符字面量，不会吞掉后面的代码', () => {
    const text = ["fn f<'a>(x: &'a str) -> &'a str {", '    x', '}'].join('\n');
    assert.equal(eff(text, '.rs'), 3);
  });

  it('字符字面量里的引号按字符串处理', () => {
    const text = ["let q = '\\'';", 'let c = 1;'].join('\n');
    assert.equal(eff(text, '.rs'), 2);
  });
});

describe('measureSource — 前端词法边界', () => {
  it('URL 字符串里的 // 不是注释', () => {
    const text = ['const url = "https://example.com/a";', 'const ok = true;'].join('\n');
    assert.equal(eff(text, '.ts'), 2);
  });

  it('模板字符串可跨行，内部行算代码', () => {
    const text = ['const s = `第一行', '第二行`;', 'const x = 1;'].join('\n');
    assert.equal(eff(text, '.ts'), 3);
  });

  it('模板字符串里以 // 开头的行是内容，不是注释', () => {
    const text = ['const s = `', '// 这是模板内容', '`;'].join('\n');
    assert.equal(eff(text, '.ts'), 3);
  });

  it('字符串未闭合时影响止于当前行（失败安全）', () => {
    const text = ["const s = 'it's fine", 'function g() {', '  return 1;', '}'].join('\n');
    assert.equal(eff(text, '.ts'), 4);
  });

  it('CSS 里 // 不是行注释，url 里的斜杠不算注释', () => {
    const text = ['/* 注释 */', '.a { background: url(http://x/y.png); }', '// 这在 CSS 里是无效声明，按代码行算'].join('\n');
    assert.equal(eff(text, '.css'), 2);
  });

  it('CSS 字符串里的 /* 不开启块注释', () => {
    const text = ['.a::before { content: "/*"; }', '.b { color: red; }'].join('\n');
    assert.equal(eff(text, '.css'), 2);
  });
});

describe('measureSource — 物理行一致性', () => {
  const samples = [
    ['', '.ts'],
    ['a', '.ts'],
    ['a\n', '.ts'],
    ['a\nb', '.ts'],
    ['a\r\nb\r\n', '.ts'],
    ['\n\n\n', '.ts'],
  ];
  for (const [text, ext] of samples) {
    it(`raw 与旧口径一致：${JSON.stringify(text)}`, () => {
      assert.equal(measureSource(text, ext).raw, physicalLines(text));
    });
  }
});
