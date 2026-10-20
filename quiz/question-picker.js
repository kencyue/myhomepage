// 管理員挑題與 Excel 匯出。題庫資料由主頁既有的 Firestore 監聽器提供。
export function selectQuestionsByCategory(source, requirements) {
    const selected = [];
    const seenCategories = new Set();
    for (const requirement of requirements) {
        const { categoryId, count } = requirement;
        if (seenCategories.has(categoryId)) throw new Error('題目類別不可重複選取。');
        seenCategories.add(categoryId);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('抽題數必須是非負整數。');
        if (count === 0) continue;
        const pool = source.filter(q => q.questionCategoryId === categoryId);
        if (count > pool.length) throw new Error('所選類別題數不足，請調整抽題數。');
        // Fisher–Yates，避免類別內重複抽題，且不更動原始題庫順序。
        const shuffled = pool.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        selected.push(...shuffled.slice(0, count));
    }
    return selected;
}

// 從同一批題目產生試卷；每張試卷保留正確答案對應新選項的位置。
function shuffledCopy(items) {
    const values = items.slice();
    for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
}

export function buildPaper(items, shuffle, alternate = false) {
    const ordered = shuffle || alternate ? shuffledCopy(items) : items.slice();
    if (alternate && items.length > 1 && ordered.every((q, i) => q.id === items[i].id)) {
        ordered.push(ordered.shift());
    }
    return ordered.map(q => {
        const options = [q.option1, q.option2, q.option3, q.option4].map((text, index) => ({
            text: text ?? '', original: index + 1
        }));
        const arranged = shuffle ? shuffledCopy(options) : options;
        const result = { ...q };
        arranged.forEach((option, index) => {
            result['option' + (index + 1)] = option.text;
            if (option.original === Number(q.correctAnswer)) result.correctAnswer = index + 1;
        });
        return result;
    });
}

export function createQuestionPicker({ getQuestions, getProducts, getCategories, isAdmin, notify }) {
    const root = document.getElementById('question-picker-view');
    const product = root.querySelector('#picker-product');
    const rows = root.querySelector('#picker-category-rows');
    const preview = root.querySelector('#picker-preview');
    const output = root.querySelector('#picker-output');
    const summary = root.querySelector('#picker-summary');
    const exportButton = root.querySelector('#picker-export');
    const shuffleControl = root.querySelector('#picker-shuffle');
    const optionStyle = root.querySelector('#picker-option-style');
    const formatControl = root.querySelector('#picker-format');
    const copyButton = root.querySelector('#picker-copy');
    const bankButton = root.querySelector('#picker-bank');
    const bankSection = root.querySelector('#picker-bank-section');
    const bankTextarea = root.querySelector('#picker-bank-text');
    const tabButtons = Array.from(root.querySelectorAll('[data-picker-set]'));
    let picked = [];
    let papers = { A: [], B: [] };
    let activeSet = 'A';

    const sourceQuestions = () => getQuestions().filter(q => !product.value || q.productCategoryId === product.value);
    const getCategoryName = id => getCategories().find(c => c.id === id)?.name || '已刪除類別';
    const getProductName = id => getProducts().find(c => c.id === id)?.name || '已刪除類別';
    const answerLetter = answer => {
        const index = Number(answer) - 1;
        return optionStyle.value === '1234' ? String(index + 1) : (['A', 'B', 'C', 'D'][index] || '');
    };

    function remakePapers() {
        papers = {
            A: buildPaper(picked, shuffleControl.checked, false),
            B: buildPaper(picked, shuffleControl.checked, true)
        };
    }

    function setActiveSet(set) {
        activeSet = set;
        tabButtons.forEach(button => {
            const active = button.dataset.pickerSet === set;
            button.setAttribute('aria-selected', String(active));
            button.classList.toggle('bg-indigo-600', active);
            button.classList.toggle('text-white', active);
            button.classList.toggle('bg-gray-100', !active);
            button.classList.toggle('text-gray-700', !active);
        });
        if (picked.length) renderPreview();
    }

    function reset() {
        picked = [];
        papers = { A: [], B: [] };
        exportButton.disabled = true;
        copyButton.disabled = true;
        bankButton.disabled = true;
        bankSection.classList.add('hidden');
        bankTextarea.value = '';
        output.classList.add('hidden');
        preview.replaceChildren();
        summary.textContent = '設定各類別的抽題數，再按「隨機挑題」。';
    }

    function refresh() {
        if (!isAdmin()) {
            reset();
            return;
        }
        const productId = product.value;
        const counts = new Map(Array.from(rows.querySelectorAll('input[data-category-id]'), input =>
            [input.dataset.categoryId, input.value]));

        product.replaceChildren(new Option('全部商品類別', ''));
        for (const cat of getProducts()) product.add(new Option(cat.name, cat.id));
        product.value = getProducts().some(cat => cat.id === productId) ? productId : '';

        const availableQuestions = sourceQuestions();
        const fragment = document.createDocumentFragment();
        for (const cat of getCategories()) {
            const available = availableQuestions.filter(q => q.questionCategoryId === cat.id).length;
            const row = document.createElement('div');
            row.className = 'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3';
            const description = document.createElement('div');
            description.className = 'min-w-0 flex-1';
            const name = document.createElement('div');
            name.className = 'font-semibold text-gray-800';
            name.textContent = cat.name;
            const availableLabel = document.createElement('div');
            availableLabel.className = 'text-xs text-gray-500 mt-1';
            availableLabel.textContent = '目前可抽 ' + available + ' 題';
            description.append(name, availableLabel);

            const control = document.createElement('label');
            control.className = 'flex items-center gap-2 text-sm font-medium text-gray-600';
            control.append(document.createTextNode('抽取'));
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.max = String(available);
            input.step = '1';
            input.inputMode = 'numeric';
            input.value = counts.get(cat.id) ?? '0';
            input.dataset.categoryId = cat.id;
            input.setAttribute('aria-label', cat.name + '抽題數');
            input.className = 'w-20 rounded-lg border border-gray-300 bg-white px-2 py-2 text-center text-gray-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
            input.addEventListener('input', () => {
                reset();
                updatePlannedTotal();
            });
            control.append(input, document.createTextNode('題'));
            row.append(description, control);
            fragment.append(row);
        }
        rows.replaceChildren(fragment);
        reset();
        updatePlannedTotal();
        root.querySelector('#picker-available-total').textContent = '範圍內共 ' + availableQuestions.length + ' 題';
        root.querySelector('#picker-empty').classList.toggle('hidden', getCategories().length > 0);
    }

    function updatePlannedTotal() {
        const requested = Array.from(rows.querySelectorAll('input[data-category-id]'))
            .reduce((total, input) => total + (Number(input.value) || 0), 0);
        root.querySelector('#picker-request-total').textContent = '預計抽取：' + requested + ' 題';
    }

    function requirements() {
        return Array.from(rows.querySelectorAll('input[data-category-id]'), input => ({
            categoryId: input.dataset.categoryId,
            count: Number(input.value)
        }));
    }

    function renderPreview() {
        preview.replaceChildren();
        const selectedIds = new Set(picked.map(q => q.id));
        const source = sourceQuestions();
        papers[activeSet].forEach((q, index) => {
            const card = document.createElement('article');
            card.className = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm';
            const top = document.createElement('div');
            top.className = 'flex flex-wrap items-start justify-between gap-3';
            const body = document.createElement('div');
            body.className = 'min-w-0 flex-1';
            const meta = document.createElement('p');
            meta.className = 'text-xs font-medium text-indigo-700 mb-2';
            meta.textContent = (index + 1) + '. ' + getProductName(q.productCategoryId) + ' / ' + getCategoryName(q.questionCategoryId) + ' / 原題號 ' + (q.questionNumber || '—');
            const title = document.createElement('p');
            title.className = 'font-medium text-gray-900 whitespace-pre-wrap break-words';
            title.textContent = q.questionText || '';
            body.append(meta, title);
            const replace = document.createElement('button');
            replace.type = 'button';
            replace.className = 'rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40';
            replace.textContent = '換一題';
            replace.disabled = !source.some(candidate =>
                candidate.questionCategoryId === q.questionCategoryId && !selectedIds.has(candidate.id));
            replace.addEventListener('click', () => {
                const unused = source.filter(candidate =>
                    candidate.questionCategoryId === q.questionCategoryId &&
                    !picked.some(selected => selected.id === candidate.id));
                if (!unused.length) return;
                const originalIndex = picked.findIndex(selected => selected.id === q.id);
                if (originalIndex < 0) return;
                picked[originalIndex] = unused[Math.floor(Math.random() * unused.length)];
                remakePapers();
                bankSection.classList.add('hidden');
                renderPreview();
                notify('已替換第 ' + (index + 1) + ' 題。', 'success');
            });
            top.append(body, replace);
            const details = document.createElement('details');
            details.className = 'mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600';
            const toggle = document.createElement('summary');
            toggle.className = 'cursor-pointer font-medium';
            toggle.textContent = '查看選項與正確答案';
            details.append(toggle);
            for (let choice = 1; choice <= 4; choice++) {
                const line = document.createElement('p');
                line.className = 'mt-2 whitespace-pre-wrap break-words' +
                    (Number(q.correctAnswer) === choice ? ' font-semibold text-green-700' : '');
                line.textContent = answerLetter(choice) + '. ' + (q['option' + choice] || '') +
                    (Number(q.correctAnswer) === choice ? ' ✓' : '');
                details.append(line);
            }
            card.append(top, details);
            preview.append(card);
        });
        summary.textContent = '已挑選 ' + picked.length + ' 題，目前預覽 ' + activeSet +
            ' 卷。A、B 卷使用相同題目，順序不同；勾選打亂時也會重新安排選項及答案。';
        output.classList.remove('hidden');
        exportButton.disabled = false;
        copyButton.disabled = false;
        bankButton.disabled = false;
    }

    function draw() {
        if (!isAdmin()) return;
        const rules = requirements();
        if (rules.some(rule => !Number.isSafeInteger(rule.count) || rule.count < 0)) {
            notify('每個類別的抽題數必須是 0 或正整數。', 'error');
            return;
        }
        if (!rules.some(rule => rule.count > 0)) {
            notify('請至少在一個題目類別設定抽題數。', 'error');
            return;
        }
        const available = sourceQuestions();
        for (const rule of rules) {
            const count = available.filter(q => q.questionCategoryId === rule.categoryId).length;
            if (rule.count > count) {
                notify('「' + getCategoryName(rule.categoryId) + '」只有 ' + count + ' 題，無法抽取 ' + rule.count + ' 題。', 'error');
                return;
            }
        }
        try {
            picked = selectQuestionsByCategory(available, rules);
            remakePapers();
            bankSection.classList.add('hidden');
            renderPreview();
            notify('成功挑選 ' + picked.length + ' 題。', 'success');
        } catch (error) {
            notify(error.message, 'error');
        }
    }

    // 對應原 PHP 版的 A(展開)、B(簡化)表格格式。
    function paperRows(paper) {
        const style = formatControl.value;
        if (style === 'compact') {
            const data = [['序號', '答案', '題目與選項 (簡化版)']];
            paper.forEach((q, index) => {
                data.push([index + 1, answerLetter(q.correctAnswer), q.questionText || '']);
                for (let i = 1; i <= 4; i++) {
                    data.push(['', '', answerLetter(i) + '. ' + (q['option' + i] || '')]);
                }
            });
            return { data, widths: [12, 14, 95] };
        }
        const keys = [1, 2, 3, 4].map(i => '選項 ' + answerLetter(i));
        const data = [['序號', '答案', '題目', ...keys]];
        paper.forEach((q, index) => {
            data.push([index + 1, answerLetter(q.correctAnswer), q.questionText || '',
                q.option1 || '', q.option2 || '', q.option3 || '', q.option4 || '']);
        });
        return { data, widths: [12, 12, 65, 35, 35, 35, 35] };
    }

    function makeAnswersRows() {
        const data = [['卷別', '序號', '原題號', '商品類別', '題目類別', '答案', '答案文字']];
        for (const set of ['A', 'B']) {
            papers[set].forEach((q, index) => {
                data.push([set, index + 1, String(q.questionNumber ?? ''),
                    getProductName(q.productCategoryId), getCategoryName(q.questionCategoryId),
                    answerLetter(q.correctAnswer), q['option' + q.correctAnswer] || '']);
            });
        }
        return data;
    }

    function exportExcel() {
        if (!isAdmin() || !picked.length) return;
        if (typeof window.XLSX === 'undefined') {
            notify('Excel 套件尚未載入，請確認網路後重新整理頁面。', 'error');
            return;
        }
        const statsSheet = [['商品篩選', product.value ? getProductName(product.value) : '全部商品類別'],
            ['匯出時間', new Date().toLocaleString('zh-TW')],
            ['總題數', picked.length], ['選項處理', shuffleControl.checked ? '題目和選項均打亂' : 'B 卷重新排序題目'],
            ['選項編號', optionStyle.value === '1234' ? '1、2、3、4' : 'A、B、C、D'], [],
            ['題目類別', '可抽題數', '抽取題數']];
        for (const cat of getCategories()) {
            const count = picked.filter(q => q.questionCategoryId === cat.id).length;
            if (count) statsSheet.push([cat.name, sourceQuestions().filter(q => q.questionCategoryId === cat.id).length, count]);
        }
        try {
            const workbook = window.XLSX.utils.book_new();
            const sheets = [
                { name: 'A卷', ...paperRows(papers.A) },
                { name: 'B卷', ...paperRows(papers.B) },
                { name: '答案對照', data: makeAnswersRows(), widths: [10, 10, 20, 18, 18, 12, 55] },
                { name: '抽題統計', data: statsSheet, widths: [25, 25, 22] }
            ];
            for (const spec of sheets) {
                const sheet = window.XLSX.utils.aoa_to_sheet(spec.data);
                sheet['!cols'] = spec.widths.map(wch => ({ wch }));
                if (spec.name !== '抽題統計' && sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
                window.XLSX.utils.book_append_sheet(workbook, sheet, spec.name);
            }
            const time = new Date();
            const stamp = time.getFullYear().toString() +
                String(time.getMonth() + 1).padStart(2, '0') +
                String(time.getDate()).padStart(2, '0') + '_' +
                String(time.getHours()).padStart(2, '0') + String(time.getMinutes()).padStart(2, '0');
            window.XLSX.writeFile(workbook, '挑題試卷_' + stamp + '.xlsx');
            notify('已匯出 A／B 卷及答案對照，共 ' + picked.length + ' 題。', 'success');
        } catch (error) {
            console.error('Excel 匯出失敗:', error);
            notify('Excel 匯出失敗：' + error.message, 'error');
        }
    }

    async function copyPaper() {
        if (!picked.length || !isAdmin()) return;
        const text = paperRows(papers[activeSet]).data.map(row =>
            row.map(value => String(value ?? '').replaceAll('\t', ' ').replaceAll('\n', ' ')).join('\t')
        ).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            notify(activeSet + ' 卷表格已複製，可貼到 Excel。', 'success');
        } catch (error) {
            notify('複製失敗，請檢查瀏覽器剪貼簿權限。', 'error');
        }
    }

    function makeBankText() {
        if (!picked.length || !isAdmin()) return;
        const result = [];
        for (const category of getCategories()) {
            const group = picked.filter(q => q.questionCategoryId === category.id);
            if (!group.length) continue;
            result.push('====== 【分類: ' + category.name + ' (' + group.length + ' 題)】 ======');
            group.forEach((q, index) => {
                const option = String(q['option' + q.correctAnswer] ?? '').trim();
                result.push('[ID:' + q.id + '] ' + (index + 1) + '. ' +
                    String(q.questionText ?? '').trim().replaceAll('\n', ' ') + '…' + option);
            });
            result.push('');
        }
        bankTextarea.value = result.join('\n').trim();
        bankSection.classList.remove('hidden');
        notify('已生成 ' + picked.length + ' 題純文字題庫。', 'success');
    }

    product.addEventListener('change', refresh);
    shuffleControl.addEventListener('change', () => {
        if (picked.length) {
            remakePapers();
            renderPreview();
        }
    });
    optionStyle.addEventListener('change', () => { if (picked.length) renderPreview(); });
    formatControl.addEventListener('change', () => { if (picked.length) renderPreview(); });
    tabButtons.forEach(btn => btn.addEventListener('click', () => setActiveSet(btn.dataset.pickerSet)));
    root.querySelector('#picker-draw').addEventListener('click', draw);
    exportButton.addEventListener('click', exportExcel);
    copyButton.addEventListener('click', copyPaper);
    bankButton.addEventListener('click', makeBankText);
    return { refresh, reset };
}
