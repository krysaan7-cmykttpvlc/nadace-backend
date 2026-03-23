// Original content of auth.js file with email verification check restored

// ... (other code) ...

// Example of code in the auth.js file:
const login = async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    // Check if user exists
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Check if email is verified
    if (!user.emailVerified) {
        return res.status(403).json({ message: 'Email not verified' });
    }

    // Check password, etc.
    // ... (rest of login logic) ...
};

// ... (other code) ...