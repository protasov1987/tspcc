function renderReceiptsTable() {
  const wrapper = document.getElementById('receipts-table-wrapper');
  if (!wrapper) {
    console.error('Receipts table wrapper not found');
    return;
  }

  // Убедимся, что store.receipts существует и является массивом
  const receipts = Array.isArray(store.receipts) ? store.receipts : [];

  if (receipts.length === 0) {
    wrapper.innerHTML = '<p>Приемок нет.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>ID</th>
        <th>Дата</th>
        <th>Поставщик</th>
        <th>Кол-во позиций</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  
  receipts.forEach(receipt => {
    const row = tbody.insertRow();
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <td>${escapeHtml(receipt.id)}</td>
      <td>${escapeHtml(new Date(receipt.date).toLocaleString())}</td>
      <td>${escapeHtml(receipt.supplier)}</td>
      <td>${escapeHtml(receipt.items.length)}</td>
    `;
    row.addEventListener('click', () => {
      navigateTo(`/receipts/${receipt.id}`);
    });
  });

  table.appendChild(tbody);

  wrapper.innerHTML = '';
  wrapper.appendChild(table);
}
