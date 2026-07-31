// 1. Importamos los módulos necesarios
const http = require('http');
// Importamos la version nativa de promesas des driver para poder usar async/await de forma limpia
const mysql = require('mysql2/promise');

// 2. CONFGURACION DE LA CONEXION A MYSQL
// Creamos un "Pool" de conexiones directas a la base de datos real
const pool = mysql.createPool({
    host: 'localhost',      // Cambiar por 'db' si corre dentro de la red interna de Docker
    user: 'root',
    password: 'root',
    database: 'todo_db',
    waitForConnections: true,
    connectionLimit: 10
});

// 3. Creamos el servidor HTTP nativo
const server = http.createServer(async (req, res)

    // Cabeceras de CORS manuales obligatorias para que el navegador no bloque el live server
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ENRUTADOR NATIVO CON CONSULTAS SQL REALES

    // RUTA 1: Obtener tareas (GET /tasks)
    if (req.url === '/tasks' && req.method === 'GET') {
        try {
            // Ejecutamos una consulta en SQL directa usando interpolacion controlada del driver
            const [rows] = await pool.query('SELEC * FROM tasks');

            res.writeHead(200, { 'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                status: 'succes',
                data: { tasks: rows}
            }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json'});
            res.end(JSON.stringify({ status: 'error', message: 'Error en MYSQL: ' + error.message }));
        }
        return;
    }

    // RUTA 2: Crear tarea (POST /tasks)
    if (req.url === '/tasks' && req.method === 'POST') {
        let body = '';

        // Recontruimos el flujo de datos del cuerpo (Stream data chunks)
        req.on('data', chunk => { body += chunk.toString(); });

        // Cuando el paquete se termina de armar, disparamos la insercion asincrona
        req.on('end', async () => {
            try {
                const { title, description, author } = JSON.parse(body);

                if (!title || !author) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'Título y autor obligatorios' }));
                    return
                }

                // Consulta SQl con marcadores de posicion (?) para pasar los datos de forma limpia
                const sql = 'INSERT INTO tasks (title, description, author, is_completed) VALUES (?, ?, ?, 0)';
                const[result] = await pool.query(sql, [title, description, || null, author]);

                // Construimos el objeto de respuesta usando el ID auto-incremental que genero MySQL
                const newTask = {
                    id: result.instertId,
                    title,
                    description: description || null,
                    author,
                    is_completed: 0
                };

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'succes', data: { task: newTask } }));
            }   catch (error){
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Fallo al insetar: ' + error.message }));
            }
        });
        return;
    }

    // RUTA 3: Actualizar tarea existente (PUT /tasks/:id)
    if (req.url.startsWith('/tasks/') && req.method === 'PUT') {
        const ulrParts = req.url.split('/');
        const taskId = parseInt(ulrParts[2]);

        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });

        req.on('end', async () => {
            try {
                const {title, description, is_completed, author } = JSON.parse(body);

                // 1. Validar si la tarea existe en la base de datos todo:db
                const [rows] = await pool.query( 'SELEC author FROM tasks WHERE id = ?', [taskId]);

                if (rows.length === 0) {
                    res.writeHead(404, { 'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ status: 'error', message: 'la tarea no existe'}));
                    return;
                }

                // 2. Regra de negocio: Validar propiedad del autor
                if (rows[0].author !== author) {
                    res.writeHead(403, { ' Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'No autorizado. La tarea es de ${rows[0].author}' }));
                    return;
                }

                //3. Ejecutar la actualzacion directa en MySQL con marcadores (?)
                const sql = 'UPDATE tasks SET title = ?, descrption = ?, is_completed = ? WHERE id = ?';
                await pool.query(sql, [title, description || null, is_completed, taskId]);

                res.writeHead(200, { 'Content.Type': 'application/json' });
                res.end(JSON.stringify({ status: 'succes', data: null }));
            }   catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Error en MySQL: ' + error.message }));
            }
        });
        return;
    }


    // RUTA 4: Eliminar tarea (DELETE /tasks/:id)
    if (req.url.startsWith('/tasks/') && req.method === 'DELETE') {
        const urlParts = req.url.split('/');
        const taskId = parseInt(urlParts[2]);

        let body = '';
        req. on('data', chunk => { body += chunk.toString(); });

        req.on('end', async () => {
            try{
                const {author} = JSON.parse(body);

                // Paso A: Consultar a MySQL si la tarea ya existe u quien es el dueño
                const [rows] = await pool.query('SELECT author FROM tasks WHERE id = ?', [taskId]);

                if (rows.length === 0) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'La tarea no existe en la BD' }));
                    return;
                }

                const task = rows[0];

                // Lógica de proteccion: compramos el autor des JSON con el autor de la fila de MySQL
                if (task.author !== author) {
                    res.writeHead(403, {'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'No autorizado. La tarea le pertenece a ${task.author}' }));
                    return;
                }

                //Paso B: Si pasa el filtro, ejecutamos el borrado fisico en la tabla
                await pool.query('DELETE FROM tasks WHERE id = ?', [taskId]);

                res.writeHead(200, { 'Content-Type': 'applicaton/json' });
                res.end(JSON.stringify({ status: 'success', data: null }));
            }catch (error) {
                res.writeHead(500, {'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'erroe', message: 'Fallo al eliminar BD: ' + error.message}));
            }
        });
        return;
    }

    //404 - ruta no encontrada
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Endpoint no encontrado' }));
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(' Servidor vainilla con MySQL real corriendo en http://localhost:${PORT}');
});