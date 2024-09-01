require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');
const multer = require('multer');
const sharp = require('sharp');

const app = express();
app.use(cors());
app.use(bodyParser.json());
const upload = multer({ storage: multer.memoryStorage() }); // Configure multer to handle the file upload

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
                    userID: user.userID,
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

// POST endpoint for image upload
app.post('/api/posts/:postId/upload-images', upload.single('image'), async (req, res) => {
    if (!req.file) {
        res.status(400).send('No file uploaded.');
        return;
    }

    const { postId } = req.params;

    try {
        const imageBuffer = req.file.buffer;

        // Determine image format using sharp metadata
        const imageMetadata = await sharp(imageBuffer).metadata();
        const imageFormat = imageMetadata.format || 'jpeg';  // Default to jpeg if format is undefined

        // Compress the image using sharp
        const compressedImageBuffer = await sharp(imageBuffer)
            .toFormat(imageFormat, { quality: 60 }) // Maintain original format and adjust quality
            .toBuffer();

        // Insert compressed image data into the database
        const query = 'INSERT INTO post_images (postID, image) VALUES (?, ?)';
        db.execute(query, [postId, compressedImageBuffer], (err, result) => {
            if (err) {
                console.error('Error inserting image:', err);
                res.status(500).send('Failed to insert image into database');
                return;
            }
            res.send({ id: result.insertId, message: 'Image uploaded successfully' });
        });
    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

// Fetch posts
app.get('/api/posts', async (req, res) => {
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 30; // default limit to 30
    const userId = parseInt(req.query.userId); // User ID passed as a query parameter

    const sqlPosts = `SELECT p.postID, p.content, p.timestamp, u.userID, u.firstName, u.lastName,
                      (SELECT COUNT(l.likeID) FROM likes l WHERE l.postID = p.postID) AS like_count,
                      (SELECT CASE 
                          WHEN EXISTS (
                              SELECT 1 FROM likes l WHERE l.postID = p.postID AND l.userID = ?
                          ) THEN TRUE 
                          ELSE FALSE 
                      END) AS liked
                      FROM posts p
                      JOIN users u ON p.userID = u.userID
                      ORDER BY p.timestamp DESC 
                      LIMIT ? OFFSET ?;`;

    const sqlImages = `SELECT pi.postID, pi.imageID FROM post_images pi ORDER BY pi.postID;`;
    const sqlProfilePictures = `SELECT pp.userID, pp.pictureID FROM profile_pictures pp ORDER BY pp.userID;`;

    try {
        const [posts] = await db.promise().query(sqlPosts, [userId, limit, offset]);
        const [images] = await db.promise().query(sqlImages);
        const [profilePictures] = await db.promise().query(sqlProfilePictures);

        // Manually aggregate image IDs and profile picture IDs to posts
        const postsWithImageIdsAndProfilePictures = posts.map(post => ({
            ...post,
            imageIds: images.filter(img => img.postID === post.postID).map(img => img.imageID),
            profilePictureId: profilePictures.find(pic => pic.userID === post.userID)?.pictureID || null,
            like_count: post.like_count,
            liked: post.liked === 1 // Convert 1 to true and 0 to false directly in the map function
        }));

        res.json(postsWithImageIdsAndProfilePictures);
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not fetch posts');
    }
});

//Endpoint to add like or remove like for a post
app.post('/api/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const checkLikeQuery = `SELECT * FROM likes WHERE postID = ? AND userID = ?`;
    const addLikeQuery = `INSERT INTO likes (postID, userID) VALUES (?, ?)`;
    const removeLikeQuery = `DELETE FROM likes WHERE postID = ? AND userID = ?`;

    try {
        const [like] = await db.promise().query(checkLikeQuery, [postId, userId]);

        if (like.length > 0) {
            // User has already liked the post, so remove the like
            await db.promise().query(removeLikeQuery, [postId, userId]);
            res.json({ liked: false });
        } else {
            // User hasn't liked the post yet, so add the like
            await db.promise().query(addLikeQuery, [postId, userId]);
            res.json({ liked: true });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Could not update like status');
    }
});


// Fetch comments for a specific post
app.get('/api/posts/:id/comments', (req, res) => {
    const { id } = req.params;
    const sql = `
        SELECT comments.*, users.firstName, users.lastName, profile_pictures.pictureID
        FROM comments 
        JOIN users ON comments.userID = users.userID
        LEFT JOIN profile_pictures ON users.userID = profile_pictures.userID
        WHERE comments.postID = ?
        ORDER BY comments.timestamp ASC;
    `;
    db.execute(sql, [id], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).send('Could not fetch comments');
        }
        res.status(200).json(results);
    });
});

//Post Image endpoint
app.get('/api/post-image/:id', (req, res) => {
    const imageId = req.params.id;

    const query = 'SELECT image FROM post_images WHERE imageID = ?';
    db.query(query, [imageId], (err, result) => {
        if (err) throw err;
        if (result.length > 0) {
            res.contentType('image/jpeg');
            res.send(result[0].image);
        } else {
            res.status(404).send('Image not found');
        }
    });
});

//Profile Picture endpoint
app.get('/api/profile-picture/:id', (req, res) => {
    const pictureID = req.params.id;

    const query = 'SELECT image FROM profile_pictures WHERE pictureID = ?';
    db.query(query, [pictureID], (err, result) => {
        if (err) throw err;
        if (result.length > 0) {
            res.contentType('image/jpeg');
            res.send(result[0].image);
        } else {
            res.status(404).send('Image not found');
        }
    });
});

