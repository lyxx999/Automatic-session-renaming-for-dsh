/**
 * dsh-session-autotitle-client — 浏览器半区 bundle。
 *
 * 1) 会话头操作行（conversation.session.header.actions）注册"自动重命名"
 *    按钮：点击走既有 wire（session.command('/autotitle')）触发宿主侧 LLM
 *    总结重命名；失败 → 命令结果以一行错误显示在会话中。
 * 2) 设置页（settings.section）注册"会话自动命名"分区：设定标题生成语言
 *    （跟随消息语言 / 中文 / English / 自定义）。存储在 llm-pi-ai 用户层
 *    顶层键 titleLanguage（与 @hytime/dsh-thinking-effort 的 subagentEffort
 *    同一惯例：schema 忽略该键但原样持久化），经标准
 *    connection.api.settings.describe / mutate 读写。
 *
 * 本文件即产物 bundle：CJS 工厂经 window.__ModuleLoader__.load 注册
 * （手写、内联样式、零构建，与 @hytime/dsh-thinking-effort 同格式）。
 */
window.__ModuleLoader__.load({
  id: '@lyxx/dsh-session-autotitle',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');

    const NS = 'session-autotitle';
    const SETTINGS_NS = 'llm-pi-ai';
    const LOCALE_DATA = {
      zh: {
        'autotitle.label': '自动重命名',
        'autotitle.aria': '自动重命名会话（LLM 总结）',
        'autotitle.busy': '正在总结…',
        'settings.title': '会话自动命名',
        'settings.description': '会话标题由 LLM 总结生成（首条提示词后自动命名；/handoff 与"自动重命名"按钮可随时重命名）。可在此设定标题语言与标题最大字节数。',
        'settings.language': '标题语言',
        'settings.languageAuto': '跟随消息语言',
        'settings.languageChinese': '中文',
        'settings.languageEnglish': 'English',
        'settings.languageCustom': '自定义',
        'settings.customPlaceholder': '如：日本語 / German / Español',
        'settings.customRequired': '请输入语言名称',
        'settings.maxBytes': '标题最大字节数',
        'settings.maxBytesHint': '1–80 之间的整数（默认 80；80 为系统硬上限）',
        'settings.maxBytesInvalid': '请输入 1–80 之间的整数',
        'settings.current': '当前：{language} · 标题 ≤ {bytes} 字节',
        'settings.apply': '应用',
        'settings.saved': '已保存',
        'settings.writeError': '写入失败：{message}',
        'settings.writeFailed': '写入失败，请重试',
        'settings.noNamespace': '未找到 llm-pi-ai 设置命名空间',
        'settings.readFailed': '读取设置失败：{message}'
      },
      en: {
        'autotitle.label': 'Auto rename',
        'autotitle.aria': 'Auto rename session (LLM summary)',
        'autotitle.busy': 'Summarizing…',
        'settings.title': 'Session auto-naming',
        'settings.description': 'Session titles are summarized by the LLM (auto after the first prompt; /handoff and the "Auto rename" button rename on demand). Set the title language and max title bytes here.',
        'settings.language': 'Title language',
        'settings.languageAuto': 'Follow message language',
        'settings.languageChinese': 'Chinese',
        'settings.languageEnglish': 'English',
        'settings.languageCustom': 'Custom',
        'settings.customPlaceholder': 'e.g. Japanese / German / Español',
        'settings.customRequired': 'Enter a language name',
        'settings.maxBytes': 'Max title bytes',
        'settings.maxBytesHint': 'Integer between 1 and 80 (default 80; 80 is the system hard cap)',
        'settings.maxBytesInvalid': 'Enter an integer between 1 and 80',
        'settings.current': 'Current: {language} · title ≤ {bytes} bytes',
        'settings.apply': 'Apply',
        'settings.saved': 'Saved',
        'settings.writeError': 'Write failed: {message}',
        'settings.writeFailed': 'Write failed, please retry',
        'settings.noNamespace': 'llm-pi-ai settings namespace not found',
        'settings.readFailed': 'Failed to read settings: {message}'
      },
      ja: {
        'autotitle.label': '自動名前変更',
        'autotitle.aria': 'セッションを自動名前変更（LLM 要約）',
        'autotitle.busy': '要約中…',
        'settings.title': 'セッション自動命名',
        'settings.description': 'セッションタイトルは LLM が要約して生成します（最初のプロンプト後に自動命名；/handoff と「自動名前変更」ボタンでいつでも変更）。タイトルの言語と最大バイト数を設定できます。',
        'settings.language': 'タイトル言語',
        'settings.languageAuto': 'メッセージの言語に従う',
        'settings.languageChinese': '中国語',
        'settings.languageEnglish': 'English',
        'settings.languageCustom': 'カスタム',
        'settings.customPlaceholder': '例：日本語 / Deutsch / Español',
        'settings.customRequired': '言語名を入力してください',
        'settings.maxBytes': 'タイトルの最大バイト数',
        'settings.maxBytesHint': '1〜80 の整数（デフォルト 80。システム上限は 80）',
        'settings.maxBytesInvalid': '1〜80 の整数を入力してください',
        'settings.current': '現在：{language} · タイトル ≤ {bytes} バイト',
        'settings.apply': '適用',
        'settings.saved': '保存しました',
        'settings.writeError': '書き込み失敗：{message}',
        'settings.writeFailed': '書き込み失敗、再試行してください',
        'settings.noNamespace': 'llm-pi-ai 設定名前空間が見つかりません',
        'settings.readFailed': '設定の読み取り失敗：{message}'
      },
      ko: {
        'autotitle.label': '자동 이름 변경',
        'autotitle.aria': '세션 자동 이름 변경 (LLM 요약)',
        'autotitle.busy': '요약 중…',
        'settings.title': '세션 자동 명명',
        'settings.description': '세션 제목은 LLM이 요약하여 생성합니다(첫 프롬프트 후 자동 명명; /handoff와 "자동 이름 변경" 버튼으로 언제든 변경). 제목 언어와 제목 최대 바이트 수를 설정할 수 있습니다.',
        'settings.language': '제목 언어',
        'settings.languageAuto': '메시지 언어 따르기',
        'settings.languageChinese': '중국어',
        'settings.languageEnglish': 'English',
        'settings.languageCustom': '사용자 지정',
        'settings.customPlaceholder': '예: 日本語 / Deutsch / Español',
        'settings.customRequired': '언어 이름을 입력하세요',
        'settings.maxBytes': '제목 최대 바이트 수',
        'settings.maxBytesHint': '1~80 사이의 정수(기본 80. 시스템 한도는 80)',
        'settings.maxBytesInvalid': '1~80 사이의 정수를 입력하세요',
        'settings.current': '현재: {language} · 제목 ≤ {bytes} 바이트',
        'settings.apply': '적용',
        'settings.saved': '저장됨',
        'settings.writeError': '쓰기 실패: {message}',
        'settings.writeFailed': '쓰기 실패, 다시 시도하세요',
        'settings.noNamespace': 'llm-pi-ai 설정 네임스페이스를 찾을 수 없습니다',
        'settings.readFailed': '설정 읽기 실패: {message}'
      }
    };
    const { zh, en, ja, ko } = LOCALE_DATA;

    function SparkleIcon({ size = 14 }) {
      return React.createElement('svg', {
        key: 'sparkle',
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block', flex: '0 0 auto' }
      }, [
        React.createElement('path', { key: 'large', d: 'm12 3-1.2 4.8L6 9l4.8 1.2L12 15l1.2-4.8L18 9l-4.8-1.2L12 3Z' }),
        React.createElement('path', { key: 'small', d: 'm19 14-.7 2.3L16 17l2.3.7L19 20l.7-2.3L22 17l-2.3-.7L19 14Z' })
      ]);
    }

    function SpinnerIcon({ size = 14 }) {
      return React.createElement('svg', {
        key: 'spinner',
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        'aria-hidden': true,
        focusable: false,
        className: 'sa-autotitle-spin',
        style: { display: 'block', flex: '0 0 auto' }
      }, React.createElement('path', { d: 'M12 3a9 9 0 1 1-9 9' }));
    }

    /** 会话头操作行按钮：点击触发 /autotitle，忙碌期间禁用。 */
    function AutotitleAction({ sessionId, t, run }) {
      const [busy, setBusy] = React.useState(false);
      const onClick = () => {
        if (busy) return;
        setBusy(true);
        Promise.resolve(run(sessionId))
          .catch(() => {})
          .finally(() => setBusy(false));
      };
      return React.createElement('button', {
        type: 'button',
        className: 'sa-autotitle',
        'aria-label': t('autotitle.aria'),
        title: t('autotitle.aria'),
        disabled: busy,
        onClick
      }, [
        busy ? SpinnerIcon({}) : SparkleIcon({}),
        React.createElement('span', { key: 'label', className: 'sa-autotitle-label' }, busy ? t('autotitle.busy') : t('autotitle.label'))
      ]);
    }

    /** 设置分区样式（与 @hytime/dsh-thinking-effort 页面同一 iOS 视觉语言）。 */
    function settingsPalette() {
      let dark = true;
      try {
        const source = window.getComputedStyle(document.body).backgroundColor;
        const values = String(source).match(/\d+(?:\.\d+)?/g);
        const alpha = values && values.length > 3 ? Number(values[3]) : 1;
        if (values && values.length >= 3 && alpha > 0) {
          const rgb = values.slice(0, 3).map(Number);
          dark = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) < 145;
        } else if (window.matchMedia) {
          dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
      } catch (_) {}
      return dark
        ? {
            canvas: '#1C1C1E', group: '#2C2C2E', field: '#2C2C2E',
            border: 'rgba(255,255,255,0.12)', divider: 'rgba(255,255,255,0.10)',
            text: '#F5F5F7', secondary: 'rgba(235,235,245,0.60)', accent: '#0A84FF',
            accentSoft: 'rgba(10,132,255,0.16)', accentBorder: 'rgba(10,132,255,0.42)',
            danger: '#FF453A', dangerBg: 'rgba(255,69,58,0.16)', dangerBorder: 'rgba(255,69,58,0.30)',
            shadow: '0 1px 1px rgba(0,0,0,0.24)'
          }
        : {
            canvas: '#F2F2F7', group: '#FFFFFF', field: '#F2F2F7',
            border: 'rgba(60,60,67,0.18)', divider: 'rgba(60,60,67,0.18)',
            text: '#1C1C1E', secondary: '#6D6D72', accent: '#007AFF',
            accentSoft: 'rgba(0,122,255,0.10)', accentBorder: 'rgba(0,122,255,0.32)',
            danger: '#FF3B30', dangerBg: 'rgba(59,48,58,0.12)', dangerBorder: 'rgba(59,48,58,0.28)',
            shadow: '0 1px 1px rgba(0,0,0,0.05)'
          };
    }

    const DRAFTS = ['auto', 'chinese', 'english', 'custom'];
    /** 标题字节数合法范围（80 = 服务侧硬上限，默认值）。 */
    const BYTES_MIN = 1;
    const BYTES_MAX = 80;

    /** 存储值 → 表单状态。空 / 'auto' → 跟随消息语言。 */
    function draftFromValue(value) {
      if (typeof value !== 'string' || value.trim() === '') return { draft: 'auto', custom: '' };
      const v = value.trim();
      if (v.toLowerCase() === 'auto') return { draft: 'auto', custom: '' };
      if (v === 'Chinese') return { draft: 'chinese', custom: '' };
      if (v === 'English') return { draft: 'english', custom: '' };
      return { draft: 'custom', custom: v };
    }

    /** 存储值 → 字节数输入框文本。非法 / 越界 → 默认 80。 */
    function bytesFromValue(value) {
      const parsed = typeof value === 'number'
        ? value
        : (typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : NaN);
      if (!Number.isInteger(parsed) || parsed < BYTES_MIN || parsed > BYTES_MAX) return String(BYTES_MAX);
      return String(parsed);
    }

    /** 设置分区：标题语言（跟随 / 中文 / English / 自定义）。 */
    function AutotitleSettings(props) {
      const settings = props.__settings;
      const settingsNew = !!props.__settingsNew;
      const t = typeof props.t === 'function'
        ? props.t
        : (key, params) => String(zh[key] || key).replace(/\{(\w+)\}/g, (match, name) => params && name in params ? String(params[name]) : match);
      const theme = settingsPalette();
      const [state, setState] = React.useState({
        loading: true, nsFound: true, draft: 'auto', custom: '', maxBytes: String(BYTES_MAX),
        revision: 0, busy: false, error: null, notice: null
      });

      const load = () => {
        setState((s) => ({ ...s, loading: true, error: null }));
        if (settings === null || settings === undefined) {
          setState((s) => ({ ...s, loading: false, error: t('settings.readFailed', { message: 'settings wire unavailable' }) }));
          return;
        }
        // 新构建（≥0.1.2）：ctx.remote.settings — describe() 无参、响应扁平 {ok, value}；
        // 旧构建：connection.api.settings — describe({})、响应 {result: {ok, value}}。
        Promise.resolve(settingsNew ? settings.describe() : settings.describe({}))
          .then((response) => {
            const envelope = settingsNew ? response : (response && response.result);
            if (!envelope || !envelope.ok) {
              const message = envelope && envelope.error && envelope.error.message
                ? envelope.error.message
                : String(envelope && envelope.error ? envelope.error : 'describe rejected');
              setState((s) => ({ ...s, loading: false, error: t('settings.readFailed', { message }) }));
              return;
            }
            const namespaces = (envelope.value && envelope.value.namespaces) || [];
            const ns = namespaces.find((n) => n.ns === SETTINGS_NS);
            if (!ns) {
              setState((s) => ({ ...s, loading: false, nsFound: false }));
              return;
            }
            const rawUser = ns.user && typeof ns.user === 'object' ? ns.user : {};
            const d = draftFromValue(rawUser.titleLanguage);
            setState((s) => ({
              ...s, loading: false, nsFound: true, draft: d.draft, custom: d.custom,
              maxBytes: bytesFromValue(rawUser.titleMaxBytes),
              revision: typeof ns.revision === 'number' ? ns.revision : 0
            }));
          })
          .catch((error) => {
            setState((s) => ({
              ...s, loading: false,
              error: t('settings.readFailed', { message: error && error.message ? error.message : String(error) })
            }));
          });
      };

      React.useEffect(() => { load(); }, []);

      const apply = () => {
        let value;
        if (state.draft === 'auto') value = null;
        else if (state.draft === 'chinese') value = 'Chinese';
        else if (state.draft === 'english') value = 'English';
        else {
          value = state.custom.trim();
          if (value === '') {
            setState((s) => ({ ...s, error: t('settings.customRequired') }));
            return;
          }
        }
        const bytesText = String(state.maxBytes).trim();
        const bytes = bytesText === '' ? NaN : Number(bytesText);
        if (!Number.isInteger(bytes) || bytes < BYTES_MIN || bytes > BYTES_MAX) {
          setState((s) => ({ ...s, error: t('settings.maxBytesInvalid') }));
          return;
        }
        const ops = value === null
          ? [{ op: 'unset', path: ['titleLanguage'] }]
          : [{ op: 'set', path: ['titleLanguage'], value }];
        // 默认值 80 → unset（不落冗余键）；其余 → set 整数
        ops.push(bytes === BYTES_MAX
          ? { op: 'unset', path: ['titleMaxBytes'] }
          : { op: 'set', path: ['titleMaxBytes'], value: bytes });
        setState((s) => ({ ...s, busy: true, error: null, notice: null }));
        // 新构建：mutate(ns, ops, expectedRevision) 位置参数 + 扁平响应；旧构建：对象参数。
        const expectedRevision = state.revision > 0 ? state.revision : undefined;
        Promise.resolve(settingsNew
          ? settings.mutate(SETTINGS_NS, ops, expectedRevision)
          : settings.mutate({ ns: SETTINGS_NS, ops, expectedRevision: state.revision }))
          .then((response) => {
            const envelope = settingsNew ? response : (response && response.result);
            if (!envelope || !envelope.ok) {
              const message = envelope && envelope.error && envelope.error.message
                ? envelope.error.message
                : String(envelope && envelope.error ? envelope.error : 'mutate rejected');
              setState((s) => ({ ...s, busy: false, error: t('settings.writeError', { message }) }));
              return;
            }
            const next = envelope.value || {};
            const rawUser = next && next.user && typeof next.user === 'object' ? next.user : {};
            const d = draftFromValue(rawUser.titleLanguage);
            setState((s) => ({
              ...s, busy: false, notice: t('settings.saved'),
              draft: d.draft, custom: d.custom, maxBytes: bytesFromValue(rawUser.titleMaxBytes),
              revision: next && typeof next.revision === 'number' ? next.revision : s.revision
            }));
          })
          .catch((error) => {
            setState((s) => ({
              ...s, busy: false,
              error: t('settings.writeError', { message: error && error.message ? error.message : String(error) })
            }));
          });
      };

      const currentLabel = state.draft === 'auto'
        ? t('settings.languageAuto')
        : state.draft === 'chinese'
          ? t('settings.languageChinese')
          : state.draft === 'english'
            ? t('settings.languageEnglish')
            : (state.custom || '—');

      const optionLabel = (key) =>
        key === 'auto' ? t('settings.languageAuto')
          : key === 'chinese' ? t('settings.languageChinese')
            : key === 'english' ? t('settings.languageEnglish')
              : t('settings.languageCustom');

      return React.createElement('div', {
        style: { position: 'relative', maxWidth: '720px', margin: '0 auto', padding: '6px 8px 30px', color: theme.text, fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif' }
      },
        React.createElement('h3', {
          style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '8px', rowGap: '4px', fontSize: '18px', lineHeight: '24px', fontWeight: 700, margin: '0 0 7px' }
        },
          SparkleIcon({ size: 18 }),
          React.createElement('span', null, t('settings.title')),
          state.notice ? React.createElement('span', {
            role: 'status', 'aria-live': 'polite',
            style: { marginLeft: 'auto', padding: '2px 6px', border: '1px solid ' + theme.accentBorder, borderRadius: '6px', color: theme.accent, backgroundColor: theme.accentSoft, fontSize: '11px', lineHeight: '16px', fontWeight: 650 }
          }, state.notice) : null
        ),
        React.createElement('p', { style: { fontSize: '12px', lineHeight: '18px', color: theme.secondary, margin: '0 0 10px' } }, t('settings.description')),
        state.error ? React.createElement('div', {
          role: 'alert', 'aria-live': 'assertive',
          style: { fontSize: '12px', lineHeight: '18px', color: theme.danger, backgroundColor: theme.dangerBg, border: '1px solid ' + theme.dangerBorder, borderRadius: '8px', padding: '6px 8px', margin: '0 0 8px' }
        }, state.error) : null,
        state.nsFound === false
          ? React.createElement('p', { style: { fontSize: '12px', opacity: 0.75 } }, t('settings.noNamespace'))
          : React.createElement('div', {
              style: { backgroundColor: theme.group, border: '1px solid ' + theme.border, borderRadius: '8px', boxShadow: theme.shadow, overflow: 'hidden' }
            },
              React.createElement('div', { style: { padding: '7px 8px 1px', fontSize: '12px', color: theme.secondary } },
                t('settings.current', { language: state.loading ? '…' : currentLabel, bytes: state.maxBytes })
              ),
              React.createElement('div', {
                style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '6px 8px 8px', borderTop: '1px solid ' + theme.divider }
              },
                React.createElement('select', {
                  value: state.draft,
                  disabled: state.busy || state.loading,
                  'aria-label': t('settings.language'),
                  onChange: (e) => setState((s) => ({ ...s, notice: null, error: null, draft: e.target.value })),
                  style: { height: '28px', minWidth: '150px', padding: '0 10px', border: '1px solid ' + theme.border, borderRadius: '8px', fontSize: '13px', fontWeight: 500, backgroundColor: theme.field, color: theme.text, colorScheme: 'light dark' }
                }, DRAFTS.map((key) => React.createElement('option', { key, value: key, style: { backgroundColor: 'Canvas', color: 'CanvasText' } }, optionLabel(key)))),
                state.draft === 'custom'
                  ? React.createElement('input', {
                      type: 'text',
                      value: state.custom,
                      placeholder: t('settings.customPlaceholder'),
                      disabled: state.busy || state.loading,
                      'aria-label': t('settings.languageCustom'),
                      style: { flex: '1 1 160px', minWidth: '140px', height: '28px', padding: '0 8px', border: '1px solid ' + theme.border, borderRadius: '8px', fontSize: '13px', backgroundColor: theme.field, color: theme.text, outline: 'none' },
                      onChange: (e) => setState((s) => ({ ...s, notice: null, error: null, custom: e.target.value }))
                    })
                  : null,
                React.createElement('input', {
                  type: 'number',
                  min: BYTES_MIN,
                  max: BYTES_MAX,
                  step: 1,
                  value: state.maxBytes,
                  disabled: state.busy || state.loading,
                  'aria-label': t('settings.maxBytes'),
                  title: t('settings.maxBytesHint'),
                  onChange: (e) => setState((s) => ({ ...s, notice: null, error: null, maxBytes: e.target.value })),
                  style: { width: '76px', height: '28px', padding: '0 8px', border: '1px solid ' + theme.border, borderRadius: '8px', fontSize: '13px', backgroundColor: theme.field, color: theme.text, outline: 'none', colorScheme: 'light dark' }
                }),
                React.createElement('button', {
                  type: 'button',
                  onClick: apply,
                  disabled: state.busy || state.loading,
                  style: { height: '28px', padding: '0 12px', border: '1px solid ' + theme.accent, borderRadius: '8px', backgroundColor: theme.accent, color: '#FFFFFF', fontSize: '12px', fontWeight: 600, cursor: state.busy || state.loading ? 'default' : 'pointer', opacity: state.busy || state.loading ? 0.5 : 1 }
                }, t('settings.apply'))
              )
            )
      );
    }

    const STYLE_TEXT = [
      '.sa-autotitle{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;',
      'border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28));',
      'border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);',
      'font-size:12px;line-height:1;font-family:inherit;cursor:pointer;white-space:nowrap;flex:0 0 auto;}',
      '.sa-autotitle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14));',
      'color:var(--dsw-alias-label,#e8e8e8);}',
      '.sa-autotitle:disabled{opacity:0.65;cursor:default;}',
      '@keyframes sa-autotitle-rotate{to{transform:rotate(360deg)}}',
      '.sa-autotitle-spin{animation:sa-autotitle-rotate 0.9s linear infinite;transform-origin:center;}'
    ].join('\n');

    function apply(ctx) {
      const sessions = ctx.sessions;
      const locale = ctx.locale;
      const connection = ctx.connection;
      const remote = typeof ctx.get === 'function' ? ctx.get('remote') : undefined;
      // 设置 wire：新构建（≥0.1.2）= ctx.remote.settings；旧构建 = connection.api.settings。
      const settings = (remote && remote.settings) || (connection && connection.api && connection.api.settings) || null;
      const settingsNew = !!(remote && remote.settings);
      /** 经既有 wire 触发宿主 /autotitle 命令；未知会话静默。 */
      const run = (sessionId) => {
        const binding = sessions.binding(sessionId);
        const session = binding === null || binding === undefined ? undefined : binding.session;
        if (session === null || session === undefined) return Promise.resolve(undefined);
        return Promise.resolve(session.command('/autotitle'));
      };

      ctx.effect(() => locale.register(NS, { zh, en, ja, ko }), 'session-autotitle: dictionaries');
      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'session-autotitle',
            order: 100,
            locale: NS
          },
          (props) => React.createElement(AutotitleAction, { ...props, run })
        ),
      );
      if (settings !== null && locale !== null && locale !== undefined && typeof locale.bind === 'function') {
        const t = locale.bind(NS);
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'session-autotitle-settings',
              order: 13,
              locale: NS,
              label: () => t('settings.title')
            },
            (props) => React.createElement(AutotitleSettings, { ...props, __settings: settings, __settingsNew: settingsNew })
          ),
        );
      }
      ctx.effect(() => {
        const style = document.createElement('style');
        style.textContent = STYLE_TEXT;
        document.head.appendChild(style);
        return () => {
          style.remove();
        };
      }, 'session-autotitle: styles');
    }

    exports.apply = apply;
    exports.inject = ['sessions', 'slots', 'locale', 'connection'];
    return module.exports;
  }
});
