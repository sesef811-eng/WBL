// Firebase Config (نفس البيانات مع إضافة measurementId)
const firebaseConfig = {
    apiKey: "AIzaSyBGPtZG34gQYuRHS-L6XQVD2hJzQk82Wtk",
    authDomain: "wbl-22ec7.firebaseapp.com",
    databaseURL: "https://wbl-22ec7-default-rtdb.firebaseio.com",
    projectId: "wbl-22ec7",
    storageBucket: "wbl-22ec7.firebasestorage.app",
    messagingSenderId: "274287684930",
    appId: "1:274287684930:web:f22ec7d9c56341dcc56cdb",
    measurementId: "G-WWMCVQ6Z09"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

// Globals
let currentUser = null;
let allBooks = [];
let userFavorites = [];
let userFollowings = [];
let lastDoc = null;
let isLoading = false;
let cache = { books: null, timestamp: 0 };
const CACHE_DURATION = 10 * 60 * 1000;

// Helper functions
function showToast(msg) {
    let t = document.createElement('div');
    t.className = 'toast';
    t.innerText = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}
function showLoader(show) {
    document.getElementById('loadingSpinner').style.display = show ? 'flex' : 'none';
}
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
}

// Load books with infinite scroll
async function loadBooks(reset = true, force = false) {
    if (!force && cache.books && (Date.now() - cache.timestamp) < CACHE_DURATION) {
        allBooks = cache.books;
        return;
    }
    if (reset) { allBooks = []; lastDoc = null; }
    if (isLoading) return;
    isLoading = true;
    showLoader(true);
    try {
        let query = db.collection('books').orderBy('createdAt', 'desc').limit(12);
        if (lastDoc) query = query.startAfter(lastDoc);
        const snap = await query.get();
        if (!snap.empty) lastDoc = snap.docs[snap.docs.length - 1];
        const newBooks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        allBooks = reset ? newBooks : [...allBooks, ...newBooks];
        if (reset) { cache.books = allBooks; cache.timestamp = Date.now(); }
    } catch (e) {
        console.error(e);
        showToast('خطأ في تحميل الكتب');
    }
    showLoader(false);
    isLoading = false;
}

async function loadUserData() {
    if (!currentUser) return;
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    if (userDoc.exists) currentUser.username = userDoc.data().username || currentUser.email.split('@')[0];
    const favSnap = await db.collection('favorites').doc(currentUser.uid).get();
    userFavorites = favSnap.exists ? favSnap.data().books : [];
    const followSnap = await db.collection('followers').where('followerId', '==', currentUser.uid).get();
    userFollowings = followSnap.docs.map(d => d.data().authorId);
}

async function toggleFavorite(bookId) {
    if (!currentUser) { window.location.href = 'login.html'; return; }
    const was = userFavorites.includes(bookId);
    userFavorites = was ? userFavorites.filter(i => i !== bookId) : [...userFavorites, bookId];
    await db.collection('favorites').doc(currentUser.uid).set({ books: userFavorites });
    showToast(was ? 'أزيلت من المفضلة' : 'أضيفت للمفضلة');
    refreshCurrentPage();
}

async function toggleFollow(authorId, authorName) {
    if (!currentUser) { window.location.href = 'login.html'; return; }
    const isFollowing = userFollowings.includes(authorId);
    if (isFollowing) {
        const q = await db.collection('followers').where('authorId', '==', authorId).where('followerId', '==', currentUser.uid).get();
        q.forEach(d => d.ref.delete());
        userFollowings = userFollowings.filter(id => id !== authorId);
        showToast('توقفت عن متابعة الكاتب');
    } else {
        await db.collection('followers').add({ authorId, followerId: currentUser.uid, authorName, followerName: currentUser.username, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        userFollowings.push(authorId);
        showToast('تمت المتابعة');
    }
}

function refreshCurrentPage() {
    const active = document.querySelector('.page.active-page')?.id;
    if (active === 'homePage') renderHome();
    else if (active === 'explorePage') renderExplore();
    else if (active === 'libraryPage') renderLibrary();
    else if (active === 'bookDetailPage' && window.currentBookId) renderBookDetail({ id: window.currentBookId });
    else if (active === 'authorPage' && window.currentAuthorId) renderAuthorPage({ id: window.currentAuthorId });
}

async function rateBook(bookId, value) {
    if (!currentUser) { window.location.href = 'login.html'; return; }
    await db.collection('ratings').doc(`${currentUser.uid}_${bookId}`).set({ bookId, userId: currentUser.uid, value });
    const snap = await db.collection('ratings').where('bookId', '==', bookId).get();
    let sum = 0, count = 0;
    snap.forEach(d => { sum += d.data().value; count++; });
    const avg = count ? sum / count : 0;
    await db.collection('books').doc(bookId).update({ rating: avg });
    showToast('تم التقييم');
    if (window.currentBookId === bookId) renderBookDetail({ id: bookId });
    else refreshCurrentPage();
}

function renderBookCard(book, isFav = null) {
    const fav = (isFav !== null) ? isFav : (currentUser && userFavorites.includes(book.id));
    let stars = '';
    let rating = book.rating || 0;
    for (let i = 1; i <= 5; i++) stars += `<i class="fas fa-star" style="color:${i <= Math.floor(rating) ? '#fbbf24' : '#d1d5db'}"></i>`;
    return `<div class="book-card" data-link="/book/${book.id}">
        <div class="card-cover lazyload" data-bg="${book.coverUrl || 'https://picsum.photos/id/104/200/300'}" style="background-image:url('data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'%3E%3Crect width='200' height='300' fill='%23e2e8f0'/%3E%3C/svg%3E')">
            ${currentUser ? `<div class="favorite-icon ${fav ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${book.id}')"><i class="fas fa-heart"></i></div>` : ''}
        </div>
        <div class="card-info">
            <div class="card-title">${escapeHtml(book.title)}</div>
            <div class="card-author" data-link="/author/${book.authorId}">${escapeHtml(book.authorName)}</div>
            <div class="rating-stars">${stars} (${rating.toFixed(1)})</div>
        </div>
    </div>`;
}

function initLazyLoad() {
    const lazyImgs = document.querySelectorAll('.lazyload');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const bg = entry.target.getAttribute('data-bg');
                if (bg) entry.target.style.backgroundImage = `url('${bg}')`;
                observer.unobserve(entry.target);
            }
        });
    });
    lazyImgs.forEach(img => observer.observe(img));
}

async function renderHome() {
    if (allBooks.length === 0) await loadBooks(true);
    const latest = allBooks.slice(0, 12);
    document.getElementById('homePage').innerHTML = `<div><h2>📚 أحدث الكتب</h2></div><div class="books-grid" id="homeGrid">${latest.map(b => renderBookCard(b)).join('')}</div><div id="homeScrollTrigger" style="height: 20px;"></div>`;
    initLazyLoad();
    attachDataLinks();
    const observer = new IntersectionObserver(async (entries) => {
        if (entries[0].isIntersecting && !isLoading && allBooks.length >= 12) {
            await loadBooks(false);
            document.getElementById('homeGrid').innerHTML = allBooks.map(b => renderBookCard(b)).join('');
            initLazyLoad();
            attachDataLinks();
        }
    });
    const trigger = document.getElementById('homeScrollTrigger');
    if (trigger) observer.observe(trigger);
}

async function renderExplore() {
    let filtered = [...allBooks];
    const genresList = ['الكل', 'فانتازيا', 'أكشن', 'مغامرات', 'غموض', 'رعب', 'تاريخي', 'دراما', 'رومانسي', 'خيال علمي', 'كوميدي', 'نفسي', 'فلسفي', 'تطوير الذات', 'ديني', 'أطفال'];
    const html = `<div><input type="text" id="exploreSearch" placeholder="🔍 بحث..." style="width:100%; padding:0.8rem; border-radius:2rem; border:1px solid var(--border);"></div><div class="filter-bar" id="exploreFilters" style="display:flex; flex-wrap:wrap; gap:0.5rem; margin:1rem 0;"></div><div id="exploreGrid" class="books-grid">${filtered.map(b => renderBookCard(b)).join('')}</div><div id="exploreScrollTrigger" style="height: 20px;"></div>`;
    document.getElementById('explorePage').innerHTML = html;
    const filtersDiv = document.getElementById('exploreFilters');
    filtersDiv.innerHTML = genresList.map(g => `<button class="filter-chip" data-genre="${g}">${g}</button>`).join('');
    document.querySelectorAll('.filter-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const genre = btn.dataset.genre;
            let filteredByGenre = genre === 'الكل' ? allBooks : allBooks.filter(b => b.genres?.includes(genre));
            const searchVal = document.getElementById('exploreSearch')?.value.toLowerCase();
            if (searchVal) filteredByGenre = filteredByGenre.filter(b => b.title.toLowerCase().includes(searchVal));
            document.getElementById('exploreGrid').innerHTML = filteredByGenre.map(b => renderBookCard(b)).join('');
            initLazyLoad();
            attachDataLinks();
        });
    });
    document.getElementById('exploreSearch')?.addEventListener('input', () => renderExplore());
    attachDataLinks();
    initLazyLoad();
    const observer = new IntersectionObserver(async (entries) => {
        if (entries[0].isIntersecting && !isLoading && allBooks.length >= 12) {
            await loadBooks(false);
            renderExplore();
        }
    });
    const trigger = document.getElementById('exploreScrollTrigger');
    if (trigger) observer.observe(trigger);
}

async function renderLibrary() {
    if (!currentUser) {
        document.getElementById('libraryPage').innerHTML = '<div><p>سجل دخولك لترى مكتبتك</p><button class="btn-primary" onclick="window.location.href=\'login.html\'">تسجيل الدخول</button></div>';
        return;
    }
    const favBooks = allBooks.filter(b => userFavorites.includes(b.id));
    document.getElementById('libraryPage').innerHTML = `<h2>مكتبتي</h2><div class="books-grid">${favBooks.length ? favBooks.map(b => renderBookCard(b, true)).join('') : '<p>لا توجد كتب مفضلة</p>'}</div>`;
    initLazyLoad();
    attachDataLinks();
}

async function renderAbout() {
    document.getElementById('aboutPage').innerHTML = `<div style="background:var(--surface); border-radius:1.5rem; padding:2rem;"><h1>عالم بين سطور (WBL)</h1><p>منصة عربية رائدة لتمكين الكتّاب والقراء.</p><button class="btn-primary" data-link="/explore">ابدأ القراءة الآن</button></div>`;
    attachDataLinks();
}

async function renderBookDetail(params) {
    const bookId = params.id;
    window.currentBookId = bookId;
    let book = allBooks.find(b => b.id === bookId);
    if (!book) {
        const snap = await db.collection('books').doc(bookId).get();
        if (snap.exists) book = { id: snap.id, ...snap.data() };
        else return navigateTo('/');
    }
    await db.collection('books').doc(bookId).update({ views: firebase.firestore.FieldValue.increment(1) });
    const chaptersSnap = await db.collection('books').doc(bookId).collection('chapters').orderBy('number').get();
    const chapters = chaptersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const isAuthor = currentUser && book.authorId === currentUser.uid;
    let chaptersHtml = '';
    if (book.bookType === 'pdf') chaptersHtml = `<div class="pdf-viewer"><iframe src="${book.pdfUrl}" width="100%" height="500px"></iframe></div>`;
    else chaptersHtml = chapters.map(ch => `<div class="chapter-item" data-link="/read/${bookId}/${ch.number}"><span>📖 الفصل ${ch.number}: ${escapeHtml(ch.title)}</span><i class="fas fa-arrow-left"></i></div>`).join('');
    if (isAuthor && book.bookType !== 'pdf') chaptersHtml += `<div style="margin-top:1rem;"><button class="btn-primary" id="manageChaptersBtn">📑 إدارة الفصول</button></div>`;
    const html = `<div style="background:var(--surface); border-radius:1rem; padding:1.5rem;"><div style="display:flex; gap:1.5rem; flex-wrap:wrap;"><img src="${book.coverUrl || 'https://picsum.photos/id/104/200/300'}" style="width:160px; border-radius:0.8rem;"><div><h1>${escapeHtml(book.title)}</h1><p><span class="author-link" data-link="/author/${book.authorId}">✍️ ${escapeHtml(book.authorName)}</span></p><div>${(book.genres || []).map(g => `<span class="filter-chip">${g}</span>`).join('')}</div><p>⭐ ${(book.rating || 0).toFixed(1)} | 👁️ ${book.views || 0} | ❤️ ${book.likes || 0}</p><p>${escapeHtml(book.description)}</p><div><button class="btn-primary" data-link="/read/${bookId}">ابدأ القراءة</button> ${currentUser ? `<button class="btn-outline" onclick="toggleFavorite('${bookId}')">❤️ ${userFavorites.includes(bookId) ? 'أزل' : 'أضف للمفضلة'}</button>` : ''}</div></div></div><hr><h3>التقييم</h3><div id="ratingStars"></div><h3>الفصول</h3>${chaptersHtml}</div>`;
    document.getElementById('bookDetailPage').innerHTML = html;
    attachDataLinks();
    if (isAuthor) document.getElementById('manageChaptersBtn')?.addEventListener('click', () => navigateTo(`/manage-chapters/${bookId}`));
    let ratingStarsDiv = document.getElementById('ratingStars');
    if (ratingStarsDiv) {
        let userRating = 0;
        if (currentUser) {
            const rateDoc = await db.collection('ratings').doc(`${currentUser.uid}_${bookId}`).get();
            if (rateDoc.exists) userRating = rateDoc.data().value;
        }
        let starsHtml = '';
        for (let i = 1; i <= 5; i++) starsHtml += `<i class="fas fa-star" style="cursor:pointer; color:${i <= userRating ? '#fbbf24' : '#d1d5db'}; font-size:1.8rem; margin:0.2rem;" onclick="rateBook('${bookId}',${i})"></i>`;
        ratingStarsDiv.innerHTML = starsHtml;
    }
}

async function renderReader(params) {
    const bookId = params.id;
    let chapterNum = params.chapter ? parseInt(params.chapter) : null;
    const book = allBooks.find(b => b.id === bookId);
    if (!book) return navigateTo('/');
    if (book.bookType === 'pdf') {
        document.getElementById('readerPage').innerHTML = `<div class="pdf-viewer"><iframe src="${book.pdfUrl}" width="100%" height="85vh"></iframe></div><button class="btn-outline" data-link="/book/${bookId}">العودة</button>`;
        attachDataLinks();
        return;
    }
    const chaptersSnap = await db.collection('books').doc(bookId).collection('chapters').orderBy('number').get();
    const chapters = chaptersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (chapters.length === 0) { showToast('لا توجد فصول'); return navigateTo(`/book/${bookId}`); }
    if (!chapterNum) chapterNum = chapters[0].number;
    const currentChapter = chapters.find(ch => ch.number === chapterNum);
    if (!currentChapter) return navigateTo(`/book/${bookId}`);
    const currentIndex = chapters.findIndex(ch => ch.number === chapterNum);
    const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null;
    const nextChapter = currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null;
    const html = `<div style="background:var(--surface); border-radius:1rem; padding:1.5rem;"><div style="display:flex; justify-content:space-between;"><h2>${escapeHtml(currentChapter.title)}</h2><button class="btn-outline" data-link="/book/${bookId}">العودة</button></div><div class="reader-content">${escapeHtml(currentChapter.content).replace(/\n/g, '<br>')}</div><div style="display:flex; justify-content:space-between; margin-top:2rem;">${prevChapter ? `<button class="btn-outline" data-link="/read/${bookId}/${prevChapter.number}">« الفصل السابق</button>` : '<span></span>'}${nextChapter ? `<button class="btn-outline" data-link="/read/${bookId}/${nextChapter.number}">الفصل التالي »</button>` : '<span></span>'}</div></div>`;
    document.getElementById('readerPage').innerHTML = html;
    attachDataLinks();
}

async function renderCreateBook() {
    if (!currentUser) { window.location.href = 'login.html'; return; }
    const html = `<div style="background:var(--surface); padding:1.5rem; border-radius:1.5rem;"><h2>📖 كتاب جديد</h2><select id="bookTypeSelect"><option value="chapters">نص فصول (محرر)</option><option value="pdf">ملف PDF</option></select><div id="pdfUploadArea" style="display:none; margin:1rem 0;"><input type="file" id="pdfFile" accept="application/pdf"></div><input id="title" placeholder="العنوان" class="auth-input"><textarea id="desc" rows="3" placeholder="الوصف" class="auth-input"></textarea><input type="file" id="coverImage" accept="image/*"><div id="genresPicker"></div><button class="btn-primary" id="saveBook">نشر الكتاب</button></div>`;
    document.getElementById('createBookPage').innerHTML = html;
    const genresList = ['فانتازيا', 'أكشن', 'مغامرات', 'غموض', 'رعب', 'تاريخي', 'دراما', 'رومانسي', 'خيال علمي', 'كوميدي', 'نفسي', 'فلسفي', 'تطوير الذات', 'ديني', 'أطفال'];
    let selected = [];
    const picker = document.getElementById('genresPicker');
    picker.innerHTML = genresList.map(g => `<button type="button" class="genre-option" data-genre="${g}" style="margin:0.2rem; padding:0.3rem 0.8rem; border-radius:2rem; border:1px solid var(--border); background:var(--background); cursor:pointer;">${g}</button>`).join('');
    picker.querySelectorAll('.genre-option').forEach(btn => btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        if (btn.classList.contains('active')) selected.push(btn.dataset.genre);
        else selected = selected.filter(g => g !== btn.dataset.genre);
        btn.style.background = btn.classList.contains('active') ? 'var(--primary)' : 'var(--background)';
        btn.style.color = btn.classList.contains('active') ? 'white' : 'var(--text)';
    }));
    document.getElementById('bookTypeSelect').addEventListener('change', () => { document.getElementById('pdfUploadArea').style.display = document.getElementById('bookTypeSelect').value === 'pdf' ? 'block' : 'none'; });
    document.getElementById('saveBook').onclick = async () => {
        const title = document.getElementById('title').value.trim();
        const desc = document.getElementById('desc').value.trim();
        if (!title || !desc || selected.length === 0) return showToast('املأ الحقول واختر تصنيفاً');
        let coverUrl = 'https://picsum.photos/id/20/200/300';
        const coverFile = document.getElementById('coverImage').files[0];
        if (coverFile) { const ref = storage.ref(`covers/${Date.now()}.${coverFile.name.split('.').pop()}`); await ref.put(coverFile); coverUrl = await ref.getDownloadURL(); }
        let pdfUrl = null;
        if (document.getElementById('bookTypeSelect').value === 'pdf') {
            const pdfFile = document.getElementById('pdfFile').files[0];
            if (!pdfFile) return showToast('يرجى رفع ملف PDF');
            const pdfRef = storage.ref(`pdfs/${Date.now()}.pdf`); await pdfRef.put(pdfFile); pdfUrl = await pdfRef.getDownloadURL();
        }
        await db.collection('books').add({ title, description: desc, coverUrl, authorId: currentUser.uid, authorName: currentUser.username, genres: selected, views: 0, rating: 0, likes: 0, chaptersCount: 0, bookType: document.getElementById('bookTypeSelect').value, pdfUrl, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        showToast('تم نشر الكتاب'); navigateTo('/publish');
    };
}

async function renderManageChapters(params) {
    const bookId = params.id;
    if (!currentUser) return;
    const bookSnap = await db.collection('books').doc(bookId).get();
    if (bookSnap.data().authorId !== currentUser.uid) return navigateTo('/');
    const chapters = await db.collection('books').doc(bookId).collection('chapters').orderBy('number').get();
    const html = `<div><h2>إدارة فصول: ${bookSnap.data().title}</h2><button class="btn-primary" id="addChapterBtn">➕ إضافة فصل جديد</button><div id="chaptersList">${chapters.docs.map(doc => `<div class="chapter-item"><span>${doc.data().number}. ${doc.data().title}</span><div><button class="btn-outline" onclick="editChapter('${bookId}','${doc.id}',${doc.data().number})">تعديل</button><button class="btn-outline" onclick="deleteChapter('${bookId}','${doc.id}')">حذف</button></div></div>`).join('')}</div><button class="btn-outline" data-link="/book/${bookId}">رجوع</button></div>`;
    document.getElementById('manageChaptersPage').innerHTML = html;
    document.getElementById('addChapterBtn')?.addEventListener('click', () => navigateTo(`/add-chapter/${bookId}`));
    attachDataLinks();
}

async function renderAddChapter(params) {
    const bookId = params.id;
    const bookSnap = await db.collection('books').doc(bookId).get();
    if (!currentUser || bookSnap.data().authorId !== currentUser.uid) return navigateTo('/');
    const chaptersCount = (await db.collection('books').doc(bookId).collection('chapters').get()).size;
    const nextNumber = chaptersCount + 1;
    const html = `<div><h2>إضافة فصل جديد</h2><input id="chapterTitle" placeholder="عنوان الفصل" class="auth-input"><textarea id="chapterContent" rows="10" placeholder="محتوى الفصل..." class="auth-input"></textarea><button class="btn-primary" id="saveChapter">حفظ الفصل</button><button class="btn-outline" data-link="/manage-chapters/${bookId}">إلغاء</button></div>`;
    document.getElementById('addChapterPage').innerHTML = html;
    document.getElementById('saveChapter').onclick = async () => {
        const title = document.getElementById('chapterTitle').value.trim();
        const content = document.getElementById('chapterContent').value.trim();
        if (!title || !content) return showToast('املأ العنوان والمحتوى');
        await db.collection('books').doc(bookId).collection('chapters').add({ number: nextNumber, title, content, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        await db.collection('books').doc(bookId).update({ chaptersCount: nextNumber });
        showToast('تم إضافة الفصل'); navigateTo(`/manage-chapters/${bookId}`);
    };
    attachDataLinks();
}

async function renderEditChapter(params) {
    const { bookId, chapterId, number } = params;
    const chapSnap = await db.collection('books').doc(bookId).collection('chapters').doc(chapterId).get();
    if (!chapSnap.exists) return navigateTo(`/manage-chapters/${bookId}`);
    const data = chapSnap.data();
    const html = `<div><h2>تعديل الفصل ${number}</h2><input id="chapterTitle" value="${escapeHtml(data.title)}" class="auth-input"><textarea id="chapterContent" rows="10" class="auth-input">${escapeHtml(data.content)}</textarea><button class="btn-primary" id="updateChapter">حفظ التعديلات</button><button class="btn-outline" data-link="/manage-chapters/${bookId}">إلغاء</button></div>`;
    document.getElementById('editChapterPage').innerHTML = html;
    document.getElementById('updateChapter').onclick = async () => {
        const title = document.getElementById('chapterTitle').value.trim();
        const content = document.getElementById('chapterContent').value.trim();
        if (!title || !content) return showToast('املأ البيانات');
        await db.collection('books').doc(bookId).collection('chapters').doc(chapterId).update({ title, content });
        showToast('تم التحديث'); navigateTo(`/manage-chapters/${bookId}`);
    };
    attachDataLinks();
}

window.editChapter = (bookId, chapterId, number) => navigateTo(`/edit-chapter/${bookId}/${chapterId}/${number}`);
window.deleteChapter = async (bookId, chapterId) => { if (confirm('هل أنت متأكد؟')) { await db.collection('books').doc(bookId).collection('chapters').doc(chapterId).delete(); showToast('تم حذف الفصل'); navigateTo(`/manage-chapters/${bookId}`); } };

async function renderPublish() {
    if (!currentUser) { window.location.href = 'login.html'; return; }
    const userBooks = allBooks.filter(b => b.authorId === currentUser.uid);
    const stats = { totalBooks: userBooks.length, totalViews: userBooks.reduce((s, b) => s + (b.views || 0), 0), totalFollowers: userFollowings.length };
    document.getElementById('publishPage').innerHTML = `<div><h2>لوحة النشر</h2><div style="display:flex; gap:1rem; background:var(--surface); padding:1rem; border-radius:1rem; margin:1rem 0;"><div>📚 الكتب: ${stats.totalBooks}</div><div>👁️ المشاهدات: ${stats.totalViews}</div><div>👥 المتابعون: ${stats.totalFollowers}</div></div><button class="btn-primary" data-link="/create-book">📖 كتاب جديد</button><h3>كتبي</h3>${userBooks.map(b => `<div style="display:flex; justify-content:space-between; padding:0.8rem; border-bottom:1px solid var(--border);"><div><strong>${escapeHtml(b.title)}</strong><br>${b.bookType === 'pdf' ? 'PDF' : `فصول: ${b.chaptersCount || 0}`}</div><div><button class="btn-outline" data-link="/book/${b.id}">معاينة</button> ${b.bookType !== 'pdf' ? `<button class="btn-outline" data-link="/manage-chapters/${b.id}">الفصول</button>` : ''}</div></div>`).join('')}</div>`;
    attachDataLinks();
}

async function renderProfile() {
    if (!currentUser) return navigateTo('/');
    document.getElementById('profilePage').innerHTML = `<div style="text-align:center;"><h2>${currentUser.username}</h2><p>${currentUser.email}</p><button class="btn-danger" id="logoutProfile">تسجيل الخروج</button></div>`;
    document.getElementById('logoutProfile')?.addEventListener('click', async () => { await auth.signOut(); location.reload(); });
}

async function renderAuthorPage(params) {
    const authorId = params.id;
    window.currentAuthorId = authorId;
    const userDoc = await db.collection('users').doc(authorId).get();
    if (!userDoc.exists) return navigateTo('/');
    const authorData = userDoc.data();
    const authorBooks = allBooks.filter(b => b.authorId === authorId);
    const followersSnap = await db.collection('followers').where('authorId', '==', authorId).get();
    const followerCount = followersSnap.size;
    const isFollowing = currentUser && userFollowings.includes(authorId);
    const totalViews = authorBooks.reduce((s, b) => s + (b.views || 0), 0);
    const level = Math.floor(authorBooks.length / 2) + 1;
    const html = `<div style="background:var(--surface); border-radius:1rem; padding:1.5rem;"><div style="text-align:center;"><i class="fas fa-user-circle" style="font-size:4rem; color:var(--primary);"></i><h2>${escapeHtml(authorData.username)}</h2><div>مستوى ${level} <span class="badge">كاتب</span></div><div>📚 ${authorBooks.length} كتب | 👁️ ${totalViews} مشاهدة | 👥 ${followerCount} متابع</div>${currentUser && currentUser.uid !== authorId ? `<button class="btn-primary" onclick="toggleFollow('${authorId}','${authorData.username}')">${isFollowing ? 'إلغاء متابعة' : 'متابعة'}</button>` : ''}</div><hr><h3>كتب الكاتب</h3><div class="books-grid">${authorBooks.map(b => renderBookCard(b)).join('')}</div></div>`;
    document.getElementById('authorPage').innerHTML = html;
    initLazyLoad();
    attachDataLinks();
}

// Sidebar & Navigation
function openSidebar() { document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebarOverlay').classList.add('active'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('active'); }
function attachDataLinks() {
    document.querySelectorAll('[data-link]').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); navigateTo(el.getAttribute('data-link')); closeSidebar(); }));
    document.querySelectorAll('.author-link').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); navigateTo(el.getAttribute('data-link')); }));
}

// Router
const routes = {
    '/': { pageId: 'homePage', render: renderHome },
    '/explore': { pageId: 'explorePage', render: renderExplore },
    '/library': { pageId: 'libraryPage', render: renderLibrary },
    '/publish': { pageId: 'publishPage', render: renderPublish },
    '/profile': { pageId: 'profilePage', render: renderProfile },
    '/book/:id': { pageId: 'bookDetailPage', render: renderBookDetail },
    '/read/:id/:chapter?': { pageId: 'readerPage', render: renderReader },
    '/create-book': { pageId: 'createBookPage', render: renderCreateBook },
    '/manage-chapters/:id': { pageId: 'manageChaptersPage', render: renderManageChapters },
    '/add-chapter/:id': { pageId: 'addChapterPage', render: renderAddChapter },
    '/edit-chapter/:bookId/:chapterId/:number': { pageId: 'editChapterPage', render: renderEditChapter },
    '/about': { pageId: 'aboutPage', render: renderAbout },
    '/author/:id': { pageId: 'authorPage', render: renderAuthorPage }
};

async function navigateTo(path, push = true) {
    showLoader(true);
    const matched = Object.keys(routes).find(route => new RegExp('^' + route.replace(/:\w+/g, '([^/]+)') + '$').test(path));
    if (!matched) { navigateTo('/'); return; }
    const route = routes[matched];
    const paramKeys = (matched.match(/:\w+/g) || []).map(k => k.slice(1));
    const values = path.split('/').filter(Boolean);
    const params = {};
    paramKeys.forEach((k, i) => params[k] = values[i + (matched.startsWith('/') ? 1 : 0)]);
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    document.getElementById(route.pageId).classList.add('active-page');
    if (push) history.pushState({}, '', path);
    await route.render(params);
    showLoader(false);
}

window.addEventListener('popstate', () => navigateTo(window.location.pathname, false));
auth.onAuthStateChanged(async user => {
    currentUser = user;
    updateSidebarUI();
    if (user) await loadUserData();
    await loadBooks(true);
    navigateTo(window.location.pathname, false);
});

function updateSidebarUI() {
    const profileDiv = document.getElementById('profileNavLink');
    const logoutDiv = document.getElementById('logoutSidebar');
    if (currentUser) {
        profileDiv.innerHTML = `<div class="nav-link" data-link="/profile"><i class="fas fa-user-circle"></i> ${currentUser.username || 'حسابي'}</div>`;
        logoutDiv.innerHTML = `<div class="nav-link" id="logoutSidebarBtn"><i class="fas fa-sign-out-alt"></i> تسجيل الخروج</div>`;
        document.getElementById('logoutSidebarBtn')?.addEventListener('click', async () => { await auth.signOut(); location.reload(); });
    } else {
        profileDiv.innerHTML = `<div class="nav-link" id="loginSidebarBtn"><i class="fas fa-sign-in-alt"></i> دخول / حساب جديد</div>`;
        document.getElementById('loginSidebarBtn')?.addEventListener('click', () => { window.location.href = 'login.html'; });
        logoutDiv.innerHTML = '';
    }
    attachDataLinks();
}

document.getElementById('menuToggle').addEventListener('click', openSidebar);
document.getElementById('closeSidebar').addEventListener('click', closeSidebar);
document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
document.getElementById('fabPublish').addEventListener('click', () => {
    if (currentUser) navigateTo('/create-book');
    else window.location.href = 'login.html';
});

window.toggleFavorite = toggleFavorite;
window.toggleFollow = toggleFollow;
window.rateBook = rateBook;
window.deleteChapter = deleteChapter;
window.editChapter = editChapter;