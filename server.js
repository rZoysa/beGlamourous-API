require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();
app.use(cors());
app.use(bodyParser.json());

//Database connection pool
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

db.connect(err => {
    if (err) throw err;
    console.log("Connected to database");
});

app.get('/', (req, res) => {
    res.status(200).send('Server is running');
});

//Singup Endpoint
app.post('/api/signup', (req, res) => {
    const { email, password, firstName, lastName, gender, age, skinType } = req.body;
    const sql = `
        INSERT INTO users (email, password, firstName, lastName, gender, age, skinType) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    db.execute(sql, [email, password, firstName, lastName, gender, age, skinType], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).send('Could not register user');
        }
        res.status(201).send('User registered');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
