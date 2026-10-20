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

// 依既有 PHP 生成器的分類比例分配題數，採最大餘數法避免總數誤差。
// 依題庫各類別實際庫存分配總題數；最大餘數法保證合計完全相符。
export function allocateProportionalCounts(pool, target) {
    if (!Number.isSafeInteger(target) || target < 1 || target > pool.length) {
        throw new Error('試卷總題數須介於 1 與已生成題庫總數之間。');
    }
    const groups = new Map();
    for (const q of pool) {
        const id = q.questionCategoryId || '__uncategorized__';
        groups.set(id, (groups.get(id) || 0) + 1);
    }
    const allocation = Array.from(groups, ([categoryId, stock]) => {
        const exact = target * stock / pool.length;
        return { categoryId, count: Math.floor(exact), fraction: exact % 1 };
    });
    let remaining = target - allocation.reduce((sum, entry) => sum + entry.count, 0);
    allocation.sort((a, b) => b.fraction - a.fraction);
    for (let i = 0; i < remaining; i++) allocation[i].count++;
    return new Map(allocation.map(({ categoryId, count }) => [categoryId, count]));
}

export function sampleProportionally(pool, target) {
    const ratios = allocateProportionalCounts(pool, target);
    return shuffledCopy(selectQuestionsByCategory(pool,
        Array.from(ratios, ([categoryId, count]) => ({ categoryId, count }))));
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
    const bankSection = root.querySelector('#picker-bank-section');
    const bankTextarea = root.querySelector('#picker-bank-text');
    const tabButtons = Array.from(root.querySelectorAll('[data-picker-set]'));
    const bankGenerateButton = root.querySelector('#picker-bank-generate');
    const bankExportButton = root.querySelector('#picker-bank-export');
    const bankStatus = root.querySelector('#picker-bank-status');
    const bankUniform = root.querySelector('#picker-bank-uniform');
    const paperTotal = root.querySelector('#picker-paper-total');
    const paperUniform = root.querySelector('#picker-paper-uniform');
    const paperRows = root.querySelector('#picker-paper-category-rows');
    const paperStatus = root.querySelector('#picker-paper-status');
    const paperDrawButton = root.querySelector('#picker-draw');
    const paperAutoButton = root.querySelector('#picker-paper-auto');
    const paperApplyUniformButton = root.querySelector('#picker-paper-apply-uniform');
    const paperStep = root.querySelector('#picker-paper-settings');
    let paperAllocationMode = 'auto';
    let bankQuestions = [];
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

    function resetPaper() {
        picked = [];
        papers = { A: [], B: [] };
        exportButton.disabled = true;
        copyButton.disabled = true;
        output.classList.add('hidden');
        preview.replaceChildren();
        summary.textContent = '先生成題庫，再設定試卷題數。';
    }

    function reset() {
        resetPaper();
        bankQuestions = [];
        bankExportButton.disabled = true;
        paperDrawButton.disabled = true;
        paperAutoButton.disabled = true;
        paperApplyUniformButton.disabled = true;
        paperTotal.value = '';
        paperTotal.max = '0';
        paperUniform.value = '';
        paperAllocationMode = 'auto';
        paperRows.replaceChildren();
        paperStep.classList.add('opacity-60');
        bankStatus.textContent = '尚未生成題庫，請先完成步驟 1。';
        paperStatus.textContent = '請先生成題庫。';
        bankSection.classList.add('hidden');
        bankTextarea.value = '';
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
        root.querySelector('#picker-request-total').textContent = requested
            ? '本次預定生成題庫：' + requested + ' 題'
            : '未設定配額：生成所有符合條件題目';
    }

    function requirements() {
        return Array.from(rows.querySelectorAll('input[data-category-id]'), input => ({
            categoryId: input.dataset.categoryId,
            count: Number(input.value)
        }));
    }

    function bankStockByCategory(id) {
        return bankQuestions.filter(q => q.questionCategoryId === id).length;
    }

    function renderPaperCategoryRows() {
        paperRows.replaceChildren();
        for (const cat of getCategories()) {
            const available = bankStockByCategory(cat.id);
            if (!available) continue;
            const wrapper = document.createElement('label');
            wrapper.className = 'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-teal-100 bg-white px-4 py-3 text-sm';
            const name = document.createElement('span');
            name.className = 'font-semibold text-gray-800';
            name.textContent = cat.name + '（題庫有 ' + available + ' 題）';
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.max = String(available);
            input.step = '1';
            input.value = '0';
            input.inputMode = 'numeric';
            input.dataset.paperCategoryId = cat.id;
            input.setAttribute('aria-label', '試卷：' + cat.name + '抽題數');
            input.className = 'w-24 rounded-lg border border-gray-300 px-3 py-2 text-center focus:border-teal-500';
            input.addEventListener('input', () => {
                paperAllocationMode = 'manual';
                resetPaper();
                updatePaperSummary();
            });
            wrapper.append(name, input);
            paperRows.append(wrapper);
        }
    }

    function paperRequirements() {
        return Array.from(paperRows.querySelectorAll('input[data-paper-category-id]'), input => ({
            categoryId: input.dataset.paperCategoryId,
            count: input.value.trim() === '' ? NaN : Number(input.value)
        }));
    }

    function updatePaperSummary() {
        const total = paperTotal.value.trim() === '' ? NaN : Number(paperTotal.value);
        const rules = paperRequirements();
        const sum = rules.reduce((n, rule) => n + (Number.isFinite(rule.count) ? rule.count : 0), 0);
        const invalid = rules.filter(rule => !Number.isSafeInteger(rule.count) || rule.count < 0 ||
            rule.count > bankStockByCategory(rule.categoryId));
        const badTotal = !Number.isSafeInteger(total) || total < 1 || total > bankQuestions.length;
        for (const input of paperRows.querySelectorAll('input[data-paper-category-id]')) {
            input.classList.toggle('border-red-500', invalid.some(rule => rule.categoryId === input.dataset.paperCategoryId));
        }
        paperDrawButton.disabled = !bankQuestions.length || badTotal || invalid.length > 0 || sum !== total;
        if (!bankQuestions.length) {
            paperStatus.textContent = '請先生成題庫。';
        } else if (badTotal) {
            paperStatus.textContent = '⚠️ 試卷總題數請設定 1 至 ' + bankQuestions.length + ' 題。';
        } else if (invalid.length) {
            paperStatus.textContent = '⚠️ 類別題數需為非負整數，且不可超過生成題庫的庫存。';
        } else if (sum !== total) {
            paperStatus.textContent = '⚠️ 各類別合計 ' + sum + ' 題，與總題數 ' + total + ' 題不符（差 ' + (total - sum) + ' 題）。';
        } else {
            paperStatus.textContent = '✅ 試卷 ' + total + ' 題／分類合計 ' + sum +
                ' 題，可以從已生成題庫抽卷' + (paperAllocationMode === 'manual' ? '（手動配額）' : '（按比例分配）') + '。';
        }
        paperStatus.classList.toggle('text-red-700', !!bankQuestions.length && (badTotal || !!invalid.length || sum !== total));
    }

    function autoAllocatePaper() {
        if (!bankQuestions.length) return;
        const total = paperTotal.value.trim() === '' ? NaN : Number(paperTotal.value);
        let allocations;
        try {
            allocations = allocateProportionalCounts(bankQuestions, total);
        } catch (error) {
            updatePaperSummary();
            return;
        }
        for (const input of paperRows.querySelectorAll('input[data-paper-category-id]')) {
            input.value = String(allocations.get(input.dataset.paperCategoryId) || 0);
        }
        paperAllocationMode = 'auto';
        resetPaper();
        updatePaperSummary();
    }

    function applyUniformPaper() {
        if (!bankQuestions.length) return;
        const count = paperUniform.value.trim() === '' ? NaN : Number(paperUniform.value);
        if (!Number.isSafeInteger(count) || count < 0) {
            notify('每類題數請輸入 0 或正整數。', 'error');
            return;
        }
        let total = 0;
        let capped = false;
        for (const input of paperRows.querySelectorAll('input[data-paper-category-id]')) {
            const available = Number(input.max);
            const amount = Math.min(count, available);
            input.value = String(amount);
            total += amount;
            if (count > available) capped = true;
        }
        paperTotal.value = String(total);
        paperAllocationMode = 'manual';
        resetPaper();
        updatePaperSummary();
        if (capped) notify('有些類別題數不足，已依目前題庫庫存上限填入。', 'info');
    }

    function applyUniformBank() {
        const amount = bankUniform.value.trim() === '' ? NaN : Number(bankUniform.value);
        if (!Number.isSafeInteger(amount) || amount < 0) {
            notify('每類題庫數請輸入 0 或正整數。', 'error');
            return;
        }
        let capped = false;
        for (const input of rows.querySelectorAll('input[data-category-id]')) {
            const available = Number(input.max);
            input.value = String(Math.min(amount, available));
            if (amount > available) capped = true;
        }
        reset();
        updatePlannedTotal();
        if (capped) notify('有些類別庫存不足，已依原始題庫上限填入。', 'info');
    }

    function renderPreview() {
        preview.replaceChildren();
        const selectedIds = new Set(picked.map(q => q.id));
        const source = bankQuestions;
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
    }

    function setPaperQuestions(questions, message) {
        picked = questions;
        remakePapers();
        renderPreview();
        notify(message, 'success');
    }

    function generateBank() {
        if (!isAdmin()) return;
        const rules = requirements();
        if (rules.some(rule => !Number.isSafeInteger(rule.count) || rule.count < 0)) {
            notify('請輸入有效的各類別題庫數量。', 'error');
            return;
        }
        const source = sourceQuestions();
        if (!source.length) {
            notify('目前選擇的商品範圍內沒有題目。', 'error');
            return;
        }
        try {
            const hasQuotas = rules.some(rule => rule.count > 0);
            const newBank = hasQuotas ? selectQuestionsByCategory(source, rules) : source.slice();
            reset();
            bankQuestions = newBank;
            paperTotal.max = String(bankQuestions.length);
            paperTotal.value = String(Math.min(20, bankQuestions.length));
            bankStatus.textContent = '✅ 已生成 ' + bankQuestions.length + ' 題題庫。試卷只會從此題庫抽取，不再回原始題庫選題。';
            bankExportButton.disabled = false;
            paperAutoButton.disabled = false;
            paperApplyUniformButton.disabled = false;
            paperStep.classList.remove('opacity-60');
            renderBankText();
            renderPaperCategoryRows();
            autoAllocatePaper();
            notify('已生成 ' + bankQuestions.length + ' 題題庫，可設定試卷題數。', 'success');
        } catch (error) {
            notify(error.message, 'error');
        }
    }

    function draw() {
        if (!isAdmin() || !bankQuestions.length) {
            notify('請先生成題庫，再從題庫抽試卷。', 'error');
            return;
        }
        updatePaperSummary();
        if (paperDrawButton.disabled) {
            notify('請檢查試卷總題數、類別合計及題庫庫存。', 'error');
            return;
        }
        try {
            const pickedFromBank = selectQuestionsByCategory(bankQuestions, paperRequirements());
            setPaperQuestions(shuffledCopy(pickedFromBank), '成功從已生成題庫抽取 ' + pickedFromBank.length + ' 題。');
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

    function exportExcel(kind = 'paper') {
        const exportingBank = kind === 'bank';
        const source = exportingBank ? bankQuestions : picked;
        if (!isAdmin() || !source.length) return;
        if (typeof window.XLSX === 'undefined') {
            notify('Excel 套件尚未載入，請確認網路後重新整理頁面。', 'error');
            return;
        }
        const statsSheet = [['商品篩選', product.value ? getProductName(product.value) : '全部商品類別'],
            ['匯出時間', new Date().toLocaleString('zh-TW')],
            ['輸出類型', exportingBank ? '題庫' : '試卷'],
            ['總題數', source.length], ['選項處理', shuffleControl.checked ? '題目和選項均打亂' : 'B 卷重新排序題目'],
            ['選項編號', optionStyle.value === '1234' ? '1、2、3、4' : 'A、B、C、D'], [],
            ['題目類別', '可抽題數', '抽取題數']];
        for (const cat of getCategories()) {
            const count = source.filter(q => q.questionCategoryId === cat.id).length;
            if (count) statsSheet.push([cat.name, sourceQuestions().filter(q => q.questionCategoryId === cat.id).length, count]);
        }
        try {
            const workbook = window.XLSX.utils.book_new();
            const bankRows = [['分類', '商品類別', '原題號', '題目', '選項A', '選項B', '選項C', '選項D', '正確答案', '正確答案內容', '題目ID']];
            source.forEach(q => bankRows.push([
                getCategoryName(q.questionCategoryId), getProductName(q.productCategoryId),
                String(q.questionNumber ?? ''), q.questionText || '',
                q.option1 || '', q.option2 || '', q.option3 || '', q.option4 || '',
                answerLetter(q.correctAnswer), q['option' + q.correctAnswer] || '', String(q.id || '')
            ]));
            const bankSpec = { name: '題庫', data: bankRows, widths: [20, 18, 18, 65, 32, 32, 32, 32, 14, 38, 28] };
            const sheets = exportingBank ? [
                bankSpec, { name: '題庫統計', data: statsSheet, widths: [25, 25, 22] }
            ] : [
                { name: 'A卷', ...paperRows(papers.A) },
                { name: 'B卷', ...paperRows(papers.B) },
                { name: '答案對照', data: makeAnswersRows(), widths: [10, 10, 20, 18, 18, 12, 55] },
                { name: '抽題統計', data: statsSheet, widths: [25, 25, 22] }
            ];
            for (const spec of sheets) {
                const sheet = window.XLSX.utils.aoa_to_sheet(spec.data);
                sheet['!cols'] = spec.widths.map(wch => ({ wch }));
                if (!spec.name.includes('統計') && sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
                window.XLSX.utils.book_append_sheet(workbook, sheet, spec.name);
            }
            const time = new Date();
            const stamp = time.getFullYear().toString() +
                String(time.getMonth() + 1).padStart(2, '0') +
                String(time.getDate()).padStart(2, '0') + '_' +
                String(time.getHours()).padStart(2, '0') + String(time.getMinutes()).padStart(2, '0');
            window.XLSX.writeFile(workbook, (exportingBank ? '題庫_' : '挑題試卷_') + stamp + '.xlsx');
            notify('已匯出' + (exportingBank ? '題庫' : ' A／B 卷及答案對照') + '，共 ' + source.length + ' 題。', 'success');
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

    function renderBankText() {
        const result = [];
        const categories = getCategories();
        const byCategory = new Map();
        bankQuestions.forEach(q => {
            const key = q.questionCategoryId || '__uncategorized__';
            if (!byCategory.has(key)) byCategory.set(key, []);
            byCategory.get(key).push(q);
        });
        for (const [id, group] of byCategory) {
            const name = categories.find(cat => cat.id === id)?.name || '未分類';
            result.push('====== 【分類: ' + name + ' (' + group.length + ' 題)】 ======');
            group.forEach((q, index) => {
                const option = String(q['option' + q.correctAnswer] ?? '').trim();
                result.push('[ID:' + q.id + '] ' + (index + 1) + '. ' +
                    String(q.questionText ?? '').trim().replaceAll('\n', ' ') + '…' + option);
            });
            result.push('');
        }
        bankTextarea.value = result.join('\n').trim();
        bankSection.classList.remove('hidden');
    }

    product.addEventListener('change', refresh);
    root.querySelector('#picker-bank-apply-uniform').addEventListener('click', applyUniformBank);
    paperTotal.addEventListener('input', () => {
        if (paperAllocationMode === 'auto') autoAllocatePaper();
        else {
            resetPaper();
            updatePaperSummary();
        }
    });
    paperAutoButton.addEventListener('click', autoAllocatePaper);
    paperApplyUniformButton.addEventListener('click', applyUniformPaper);
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
    bankGenerateButton.addEventListener('click', generateBank);
    bankExportButton.addEventListener('click', () => exportExcel('bank'));
    exportButton.addEventListener('click', () => exportExcel('paper'));
    copyButton.addEventListener('click', copyPaper);
    return { refresh, reset };
}
