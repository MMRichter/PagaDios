import { collection, doc, writeBatch, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from "./firestore.js";
/**
 * Registra una nueva compra y distribuye la deuda equitativamente.
 * 
 * @param {string} sessionId - El ID de la sesión/grupo actual.
 * @param {string} buyerId - El ID del usuario que pagó.
 * @param {number} totalAmount - El costo total de la compra.
 * @param {string} description - Qué se compró (Ej: "Asado").
 * @param {Array<string>} participantIds - Array con los IDs de todos los que comparten este gasto.
 */
async function addExpense(sessionId, buyerId, totalAmount, description, participantIds) {
    //batch
    const batch = writeBatch(db);

    //preparando el documento
    const comprasRef = collection(db, `sesiones/${sessionId}/compras`);
    const newCompraRef = doc(comprasRef); //id automatico
    
    batch.set(newCompraRef, {
        descripcion: description,
        total: totalAmount,
        pagado_por: buyerId,
        fecha: serverTimestamp(),
        estado: 'activo',
        dividido_entre: participantIds
    });

    //se divide el total por la cantidad de participantes
    const splitAmount = totalAmount / participantIds.length;

    //se actualizan los saldos
    participantIds.forEach(participantId => {
        if (participantId !== buyerId) {
            
            // Creamos un ID determinista para el documento de saldo.
            // Siempre ordenamos los IDs alfabéticamente para que A->B y B->A 
            // modifiquen el mismo documento y no queden saldos cruzados.
            const sortedIds = [participantId, buyerId].sort();
            const saldoId = `${sortedIds[0]}_${sortedIds[1]}`;
            
            const saldoRef = doc(db, `sesiones/${sessionId}/saldos/${saldoId}`);
            
            // Lógica de contabilidad:
            // Si buyer soy el ID menor (sortedIds[0]), el monto se vuelve POSITIVO en este documento.
            // Si buyer soy el ID mayor (sortedIds[1]), el monto se vuelve NEGATIVO.
            const isBuyerFirst = buyerId === sortedIds[0];
            const netAmount = isBuyerFirst ? splitAmount : -splitAmount;

            //si el documento no existe, lo crea.
            // Si ya existe, usa increment() para sumar/restar el valor matemáticamente 
            // del lado del servidor, evitando condiciones de carrera
            batch.set(saldoRef, {
                participante_A: sortedIds[0],
                participante_B: sortedIds[1],
                balance_neto_A_vs_B: increment(netAmount) 
            }, { merge: true });
        }
    });

	//ejecutamos
    try {
        await batch.commit();
        console.log("¡Gasto registrado y saldos actualizados con éxito!");
        //to do: llamar funcion para limpiar ui
    } catch (error) {
        console.error("Error al registrar el gasto. No se modificó nada.", error);
        // to do: mostrar error
    }
}

//mock data
const SESION_ACTUAL = "viaje_costa_2026";
const MI_USUARIO_ID = "matias_123";
// Asumimos que en este viaje son 3 personas
const PARTICIPANTES_ACTUALES = ["matias_123", "juan_456", "pedro_789"];

// Esperamos a que el HTML cargue
document.addEventListener('DOMContentLoaded', () => {
    
    const btnEnviar = document.getElementById('btn-enviar-gasto');
    const inputDesc = document.getElementById('gasto-desc');
    const inputMonto = document.getElementById('gasto-monto');

    btnEnviar.addEventListener('click', async () => {
        const desc = inputDesc.value.trim();
        const monto = parseFloat(inputMonto.value);

        // Validación básica
        if (!desc || isNaN(monto) || monto <= 0) {
            alert("Che, poné una descripción y un monto válido.");
            return;
        }

        //deshabilitamos el botón mientras guarda
        btnEnviar.disabled = true;
        btnEnviar.innerText = "Guardando...";

        try {
            await addExpense(SESION_ACTUAL, MI_USUARIO_ID, monto, desc, PARTICIPANTES_ACTUALES);
            
            // Limpiar inputs si salió bien
            inputDesc.value = '';
            inputMonto.value = '';
            alert("¡Gasto anotado! PagaDios.");
            
        } catch (error) {
            console.error(error);
            alert("Error al guardar el gasto.");
        } finally {
            // Restaurar botón
            btnEnviar.disabled = false;
            btnEnviar.innerText = "Enviar Gasto";
        }
    });
});

// Ejemplo de uso:
// addExpense(
//     "sesion_costa_2026", 
//     "matias_id", 
//     15000, 
//     "Carnicería", 
//     ["matias_id", "amigo1_id", "amigo2_id"]
// );
