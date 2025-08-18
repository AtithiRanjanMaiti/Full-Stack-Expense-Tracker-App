// Check token and include helper function
function getToken() {
  return localStorage.getItem('token');
}
function logout() {
  localStorage.removeItem('token');
  window.location.href = 'login.html';
}
function authFetch(url, options = {}) {
  const token = getToken();
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token,
      ...(options.headers || {})
    }
  });
}