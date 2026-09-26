import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

//aca el firebase config cuando este levantado
const firebaseConfig = {
  apiKey: "la api key",
  authDomain: "pagadios-app.firebaseapp.com",
  projectId: "pagadios-app",
  storageBucket: "pagadios-app.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123def456"
};

const app = initializeApp(firebaseConfig);

const db = getFirestore(app);

//cache offline
try {
    await enableIndexedDbPersistence(db);
    console.log("Modo offline activado con éxito.");
} catch (err) {
    if (err.code == 'failed-precondition') {
        console.warn("Múltiples pestañas abiertas, el modo offline solo funciona en una.");
    } else if (err.code == 'unimplemented') {
        console.warn("El navegador no soporta persistencia offline.");
    }
}

// Exporta la instancia
export { db };
