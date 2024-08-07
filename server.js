require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

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

// Login Endpoint
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    // SQL query to find the user by email
    const sql = `SELECT * FROM users WHERE email = ?`;

    db.execute(sql, [email], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error logging in user');
        }
        if (results.length > 0) {
            const user = results[0];
            if (user.password === password) {
                // Define the payload for the JWT
                
                const payload = {
                    id: user.userID,
                    email: user.email,
                };

                // Sign the JWT
                const token = jwt.sign(payload, process.env.JWT_SECRET, {
                    expiresIn: '30d' // expires in 30 days
                });

                res.status(200).json({
                    message: 'Login successful',
                    token: token
                });
            } else {
                res.status(401).send('Incorrect password.');
            }
        } else {
            res.status(404).send('User not found!');
        }
    });
});
