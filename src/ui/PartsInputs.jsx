// 数値などの入力欄の並び（詳しい診断の弱点の詳細・簡易診断の特記事項の寸法で使う）
//  parts：欄の定義（detailParts.js の PART_TYPES）、values：入れた値、onPut(名前, 値)：値が変わったとき
//  Choice：選択肢のボタンの部品（呼ぶ側の見た目に合わせる）
export default function PartsInputs({ parts, values, onPut, testId, Choice }) {
  const put = onPut;
  const dk = testId;
  const num = (name, v, onChange, ph) => (
    <input type="text" inputMode="decimal" value={v ?? ''} placeholder={ph} onChange={(e) => onChange(e.target.value)} data-part={name} />
  );
  return (
    <div className="parts" data-parts={dk}>
      {parts.map((p) => {
        const v = values[p.name];
        let input;
        if (p.type === 'height' || p.type === 'pair') {
          const x = v || {};
          input = (
            <span className="pair">
              {num(`${p.name}.a`, x.a, (a) => put(p.name, { ...x, a }), p.type === 'height' ? '例 2' : '')}
              <span>{p.type === 'height' ? p.sep || '～' : p.sep || '/'}</span>
              {num(`${p.name}.b`, x.b, (b) => put(p.name, { ...x, b }), p.type === 'height' ? '上端' : '')}
              <span>{p.unit ?? (p.type === 'height' ? 'm' : '')}</span>
            </span>
          );
        } else if (p.type === 'size') {
          const list = Array.isArray(v) && v.length ? v : [{}];
          const setAt = (i, patch) => put(p.name, list.map((y, j) => (j === i ? { ...y, ...patch } : y)));
          input = (
            <span className="sizes">
              {list.map((y, i) => (
                <span className="pair" key={i}>
                  {num(`${p.name}.${i}.w`, y.w, (w) => setAt(i, { w }), '縦')}
                  <span>×</span>
                  {num(`${p.name}.${i}.h`, y.h, (h) => setAt(i, { h }), '横')}
                  {p.depth && (
                    <>
                      <span>×</span>
                      {num(`${p.name}.${i}.d`, y.d, (d) => setAt(i, { d }), '奥行')}
                    </>
                  )}
                  <span>{p.unit ?? 'cm'}</span>
                </span>
              ))}
              <button type="button" className="btn" onClick={() => put(p.name, [...list, {}])} data-add-size={p.name}>
                ＋ もう1か所
              </button>
            </span>
          );
        } else if (p.type === 'flag') {
          // 印（芯達など）：押すたびに付ける／外す
          input = (
            <button type="button" className={`seg-b${v ? ' on' : ''}`} aria-pressed={!!v} onClick={() => put(p.name, !v)} data-part={p.name}>
              {p.label}
            </button>
          );
        } else if (p.type === 'choice') {
          input = <Choice k={`${dk}.${p.name}`} opts={p.options} value={v ?? ''} onPress={(_, o) => put(p.name, v === o ? '' : o)} />;
        } else if (p.type === 'text') {
          input = <input type="text" value={v ?? ''} onChange={(e) => put(p.name, e.target.value)} data-part={p.name} />;
        } else {
          input = (
            <span className="pair">
              {num(p.name, v, (x) => put(p.name, x))}
              <span>{p.unit ?? (p.type === 'count' ? '本' : '')}</span>
            </span>
          );
        }
        return (
          <label className="part" key={p.name}>
            <small>{p.type === 'flag' ? '\u00a0' : p.label}</small>
            {input}
          </label>
        );
      })}
    </div>
  );
}
