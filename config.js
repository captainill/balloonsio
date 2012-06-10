exports.config = {
	auth: {
		twitter: {
			consumerkey : process.env.BALLOONS_TWITTER_KEY,
			consumersecret : process.env.BALLOONS_TWITTER_SECRET,
			callback : process.env.TWITTER_CALLBACK ||  "http://127.0.0.1:5000/auth/twitter_callback"
		}
	},
	theme: {
		name : "default"
	},
	session : {
		secret : process.env.BALLOONS_SESSION_SECRET
	},
	app: {
		port: 5000
	}
};
