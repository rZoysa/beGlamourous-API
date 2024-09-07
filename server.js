require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');
const multer = require('multer');
const sharp = require('sharp');
const FormData = require('form-data');
const axios = require('axios');

const upload = multer({ storage: multer.memoryStorage() }); // Configure multer to handle the file upload

const app = express();
app.use(cors());
app.use(bodyParser.json());


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

app.get('/', (req, res) => {
    res.status(200).send('Server is running');
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
                    email: user.email,
                    userName: user.firstName + ' ' + user.lastName,                    
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

// Post creation and image upload
app.post('/api/add-posts', upload.single('image'), (req, res) => {
    const { userId, content } = req.body;

    // Insert post content into the posts table
    const sql = 'INSERT INTO posts (userID, content) VALUES (?, ?)';
    db.execute(sql, [userId, content], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Failed to create post');
        }

        const postId = result.insertId;

        if (req.file) {
            // If an image is included, upload it
            const imageBuffer = req.file.buffer;

            // Optionally compress the image using sharp
            sharp(imageBuffer)
                .toBuffer()
                .then((compressedImage) => {
                    const query = 'INSERT INTO post_images (postID, image) VALUES (?, ?)';
                    db.execute(query, [postId, compressedImage], (err) => {
                        if (err) {
                            console.error('Error inserting image:', err);
                            return res.status(500).send('Failed to insert image');
                        }
                        res.status(201).send({ postId, message: 'Post and image created' });
                    });
                });
        } else {
            res.status(201).send({ postId, message: 'Post created without image' });
        }
    });
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

// API endpoint to post a new comment
app.post('/api/posts/:postId/comment', (req, res) => {
    const { postId } = req.params;
    const { userId, content } = req.body;

    if (!content || !userId) {
        return res.status(400).send('User ID and comment content are required');
    }

    const sql = `INSERT INTO comments (postID, userID, content) VALUES (?, ?, ?)`;

    db.execute(sql, [postId, userId, content], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error posting comment');
        }
        res.status(201).send({ message: 'Comment posted successfully' });
    });
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

// POST endpoint for receiving and forwarding the image
app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    try {
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
        });

        const pythonApiResponse = await axios.post('http://localhost:5000/analyze-image', formData, {
            headers: {
                ...formData.getHeaders()
            }
        });

        res.json(pythonApiResponse.data);
    } catch (error) {
        console.error('Error forwarding image to Python API:', error);
        res.status(500).send('Failed to forward image to Python API');
    }
});

//Endpoint to fetch recommended products
app.get('/api/products/matching', (req, res) => {
    const { userId, concerns } = req.query;

    if (!userId) {
        return res.status(400).send('User ID is required');
    }


    const userSkinTypeQuery = `SELECT skinType FROM users WHERE userID = ?`;

    db.execute(userSkinTypeQuery, [userId], (err, userResults) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error fetching user skin type');
        }
        if (userResults.length === 0) {
            return res.status(404).send('User not found');
        }

        const skinType = userResults[0].skinType;

        let conditionQuery = '';
        if (concerns) {
            const conditionsArray = concerns.split(','); // e.g., 'acne,bags'
            const conditions = conditionsArray.map(concern => {
                if (concern === 'acne') return "'oily', 'combination'";
                if (concern === 'bags') return "'all'";
                if (concern === 'redness') return "'sensitive'";
                return "'all'";
            }).join(',');
            conditionQuery = `OR suitableSkinType IN (${conditions})`;
        }

        const productQuery = `
            SELECT * FROM products 
            WHERE suitableSkinType LIKE CONCAT('%', ?, '%') ${conditionQuery}
        `;

        db.execute(productQuery, [skinType], (err, productResults) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error fetching matching products');
            }

            res.status(200).json(productResults);
        });
    });
});

// API endpoint to save skin analysis scores
app.post('/api/save-skin-analysis', (req, res) => {
    const { userID, acne_score, bags_score, redness_score, overall_health_score } = req.body;

    const sql = `
        INSERT INTO skin_analysis_scores (userID, acne_score, bags_score, redness_score, overall_health_score)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.execute(sql, [userID, acne_score, bags_score, redness_score, overall_health_score], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error saving skin analysis scores');
        }
        res.status(201).send('Scores saved successfully');
    });
});

// API endpoint to get the latest analysis result for a user
app.get('/api/skin-analysis/latest/:userId', (req, res) => {
    const { userId } = req.params;

    const sql = `
      SELECT acne_score, bags_score, redness_score, overall_health_score, analysis_date
      FROM skin_analysis_scores
      WHERE userID = ?
      ORDER BY analysis_date DESC
      LIMIT 1;
    `;

    db.execute(sql, [userId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error fetching latest skin analysis result');
        }

        if (results.length > 0) {
            res.status(200).json(results[0]);
        } else {
            res.status(404).send('No analysis result found for the user');
        }
    });
});
