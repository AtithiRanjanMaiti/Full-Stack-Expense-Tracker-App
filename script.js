if (!localStorage.getItem('token')) {
   window.location.href = 'login.html';
} 
document.getElementById('expense-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const title = document.getElementById('title').value;
    const amount = document.getElementById('amount').value;
    const id = document.getElementById('expenseId').value;
    if (id) {
        await authFetch('/api/expenses/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, amount })
        });
    } else {
        await authFetch('/api/expenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, amount })
        });
    }
    loadExpenses();
    document.getElementById('title').value = '';
    document.getElementById('amount').value = '';
    document.getElementById('expenseId').value = ''; // clear hidden
});
async function loadExpenses() {
    const res = await authFetch('/api/expenses');
    const expenses = await res.json();
    const list = document.getElementById('expense-list');
    list.innerHTML = '';
    let total = 0;
    expenses.forEach(exp => {
        total += exp.amount;
        const li = document.createElement('li');
        li.innerHTML = `
        ${exp.title} — $${exp.amount} — ${new Date(exp.date).toLocaleDateString()}
        <button onclick="deleteExpense('${exp._id}')">Delete</button>
        <button onclick="startEdit('${exp._id}', '${exp.title}', ${exp.amount})">Edit</button>
    `;
        list.appendChild(li);
    });
    document.getElementById('total').innerText = `Total: $${total}`;
}
async function deleteExpense(id) {
    await authFetch('/api/expenses/' + id, {
        method: 'DELETE'
    });
    loadExpenses();
}
loadExpenses();
function startEdit(id, title, amount) {
    document.getElementById('title').value = title;
    document.getElementById('amount').value = amount;
    document.getElementById('expenseId').value = id;
}