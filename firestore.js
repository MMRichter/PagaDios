import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// aca el firebase config cuando este levantado
const firebaseConfig = {
    apiKey: "la api key",
    authDomain: "pagadios-app.firebaseapp.com",
    projectId: "pagadios-app",
    storageBucket: "pagadios-app.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123def456"
};

const app = initializeApp(firebaseConfig);

// Persistencia offline con soporte multi-pestaña: la caché local evita
// re-descargar documentos sin cambios y una sola pestaña hace de conexión.
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export { app, db };
