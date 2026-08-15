/**
 * firebase-sync.js
 *
 * PHASE 12 SCAFFOLD — an opt-in replacement for storage.js.
 *
 * Not included on any page by default: this app still runs on
 * localStorage everywhere (see storage.js), and nothing changes until you
 * deliberately wire this in on a per-page basis (steps below). That keeps
 * the app fully working offline/no-setup today, while giving you a clear,
 * working path to real accounts + cross-device sync when you're ready.
 *
 * To adopt it on a page:
 *   1. Create your own Firebase project and fill in firebase-config.js
 *      (see firebase-config.example.js in this same folder for the exact
 *      steps and the Firestore security rule you need).
 *   2. In that page's <head> or before this script, include the Firebase
 *      SDK via CDN:
 *        <script type="module">
 *          import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
 *          import * as authMod from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
 *          import * as fsMod from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
 *          window.__firebaseModules = { initializeApp, ...authMod, ...fsMod };
 *        </script>
 *   3. Include firebase-config.js, then this file, in place of storage.js.
 *   4. Call `await CloudStorage.init()` before reading/writing, and swap
 *      `Storage.get/set` calls for `await CloudStorage.get/set` (this
 *      layer is async because network calls are — every page's render
 *      logic would need a small `async`/`await` pass to switch over).
 *
 * Why this is a scaffold and not "done": Firestore reads/writes are
 * inherently async and per-user (behind sign-in), while every existing
 * page in this app was built against a synchronous, deviceless
 * `Storage.get/set`. Rather than silently making that swap (which would
 * require re-testing every CRUD flow in the app against real network
 * latency and auth state), this file gives you a matching API so the
 * migration is mechanical, page by page, on your schedule.
 */

const CloudStorage = {
  _app: null,
  _auth: null,
  _db: null,
  _user: null,

  /** Call once, after the Firebase SDK + your config are both loaded. */
  async init() {
    const mods = window.__firebaseModules;
    if (!mods || !window.firebaseConfig) {
      console.error('CloudStorage.init: Firebase SDK or firebase-config.js not loaded.');
      return false;
    }
    this._app = mods.initializeApp(window.firebaseConfig);
    this._auth = mods.getAuth(this._app);
    this._db = mods.getFirestore(this._app);
    this._mods = mods;

    return new Promise((resolve) => {
      mods.onAuthStateChanged(this._auth, (user) => {
        this._user = user;
        resolve(!!user);
      });
    });
  },

  async signUp(email, password) {
    const cred = await this._mods.createUserWithEmailAndPassword(this._auth, email, password);
    this._user = cred.user;
    return cred.user;
  },

  async signIn(email, password) {
    const cred = await this._mods.signInWithEmailAndPassword(this._auth, email, password);
    this._user = cred.user;
    return cred.user;
  },

  async signOut() {
    await this._mods.signOut(this._auth);
    this._user = null;
  },

  _requireUser() {
    if (!this._user) throw new Error('CloudStorage: no signed-in user. Call signIn()/signUp() first.');
    return this._user.uid;
  },

  /** Mirrors Storage.get(key, fallback), but async and scoped to the signed-in user. */
  async get(key, fallback = null) {
    const uid = this._requireUser();
    const ref = this._mods.doc(this._db, 'users', uid, 'data', key);
    const snap = await this._mods.getDoc(ref);
    return snap.exists() ? snap.data().value : fallback;
  },

  /** Mirrors Storage.set(key, value), but async and scoped to the signed-in user. */
  async set(key, value) {
    const uid = this._requireUser();
    const ref = this._mods.doc(this._db, 'users', uid, 'data', key);
    await this._mods.setDoc(ref, { value, updatedAt: Date.now() });
    return true;
  },

  async remove(key) {
    const uid = this._requireUser();
    const ref = this._mods.doc(this._db, 'users', uid, 'data', key);
    await this._mods.deleteDoc(ref);
  },

  /** One-time helper: push everything currently in localStorage up to Firestore for the signed-in user. */
  async migrateFromLocalStorage() {
    const K = window.STORAGE_KEYS;
    for (const key of Object.values(K)) {
      const local = window.Storage.get(key, null);
      if (local !== null) await this.set(key, local);
    }
  },
};

window.CloudStorage = CloudStorage;
