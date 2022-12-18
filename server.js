require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");

const session = require("express-session");
const cookieParser = require("cookie-parser");
const MemoryStore = require("memorystore")(session);
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");

const cors = require("cors");
const app = express();

const port = process.env.PORT || 8000;

app.set("trust proxy", 1);

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
app.use(bodyParser.json());
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SECRET,
    saveUninitialized: false,
    resave: true, //this was the original, trying if this causes cookie to change on signup
    // resave: false,
    store: new MemoryStore({
      checkPeriod: 18000000, // prune expired entries every 5h
    }),
    cookie: {
      path: "/",
      maxAge: 1000 * 60 * 60 * 3, //3 Hours
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

mongoose.set("strictQuery", true);

mongoose.connect(process.env.DB_URL, { useNewUrlParser: true }, () => {
  console.log("Connected to DB");
});

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  password: String,
  auth_method: String,
});

userSchema.plugin(passportLocalMongoose);

const User = mongoose.model("User", userSchema);

passport.use(User.createStrategy());

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findById(id, (err, user) => {
    done(err, user);
  });
});

const checkAuthentication = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  } else {
    res.status(401).send("Unauthorized");
  }
};

app.get("/", (req, res) => {
  res.status(200).send({
    message: "Hello! This is a private api, so thanks for visting!",
    link: "https://github.com/manfromny/car-sales-app",
  });
});

app.get("/auth/status", checkAuthentication, (req, res) => {
  res.status(200).send({
    user: req.user._id,
  });
});

app.get("/auth/logout", (req, res) => {
  req.logout((err) => {
    if (!err) {
      res.status(200).send({
        message: "Logged out successfully",
      });
    } else {
      res.status(500).send({
        message: "Something went wrong",
        error: err,
      });
    }
  });
});

app.post("/auth/login", (req, res) => {
  console.log(req.body);
  const user = new User({
    username: req.body.username,
    password: req.body.password,
  });

  req.login(user, (err) => {
    if (!err) {
      passport.authenticate("local", {
        failureMessage: true,
        refreshToken: true,
      })(req, res, () => {
        res.status(200).send({
          message: "Logged in successfully",
          userID: req.user._id,
        });
      });
    } else {
      res.status(500).send({
        message: "Something went wrong",
        error: err,
      });
    }
  });
});

app.post("/auth/signup", (req, res) => {
  console.log(req.body);
  User.register(
    {
      fullName: req.body.fullName,
      username: req.body.username,
      auth_method: "local",
    },
    req.body.password,
    (err, user) => {
      if (!err) {
        passport.authenticate("local", {
          failureMessage: true,
          refreshToken: true,
        })(req, res, () => {
          res.status(200).send({
            message: "Signed up successfully",
            userID: user._id,
          });
        });
      } else {
        res.status(500).send({
          message: "Something went wrong.",
          error: err,
        });
      }
    }
  );
});

app.listen(port, () => {
  console.log(`Server started running on port ${port}.`);
});
