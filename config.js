exports.config = {
	auth: {
		twitter: {
			consumerkey : "wovpSUMWpwLB2g9lKafxg",
			consumersecret : "TAMz3AH45WkI0NXjijchU1lYJsoy3SesiCD04xUiQs4",
			callback : process.env.TWITTER_CALLBACK ||  "http://127.0.0.1:5000/auth/twitter_callback"
		}
	},
	theme: {
		name : "default"
	},
	session : {
		secret : "vivaperon"
	},
	app: {
		port: 5000
	}
};
