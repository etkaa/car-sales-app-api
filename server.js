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
    name: "carsnow.sid",
    cookie: {
      path: "/",
      maxAge: 1000 * 60 * 60 * 4, //4 Hours
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
  favorites: [],
  auth_method: String,
});

userSchema.plugin(passportLocalMongoose);

const User = mongoose.model("User", userSchema);

const listingSchema = new mongoose.Schema({
  status: {
    type: String,
  },
  listing: {
    title: String,
    description: String,
    listingOwnerId: String,
    createdAt: Date,
  },
  condition: String,
  year: Number,
  make: String,
  model: String,
  trim: String,
  engine: {
    capacity: String,
    cylinders: Number,
    horsepower: Number,
    torque: Number,
  },
  miles: Number,
  price: {
    original: Number,
    discounted: Number,
  },
  extColor: String,
  intColor: String,
  location: {
    city: String,
    state: String,
    zip: String,
  },
  pictures: {
    cover: String,
    otherPictures: [],
  },
});

const Listing = mongoose.model("Listing", listingSchema);

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

app.post("/auth/login", (req, res) => {
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
          user: req.user,
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
  User.register(
    {
      fullName: req.body.fullName,
      username: req.body.username,
      auth_method: "local",
      favorites: [],
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
            user: user,
          });
        });
      } else {
        res.status(500).send({
          message: "Something went wrong.",
          error: err.message,
        });
      }
    }
  );
});

app.post("/auth/logout", (req, res) => {
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

app.get("/user/favorites", checkAuthentication, (req, res) => {
  User.findById(req.user._id, (err, user) => {
    if (!err) {
      res.status(200).send({
        favorites: user.favorites,
      });
    } else {
      res.status(500).send({
        message: "Something went wrong",
        error: err,
      });
    }
  });
});

app.post("/user/favorites/add", checkAuthentication, (req, res) => {
  User.findById(req.user._id, (err, user) => {
    if (!err) {
      user.favorites.push(req.body.listingID);
      user.save((err) => {
        if (!err) {
          res.status(200).send();
        } else {
          res.status(500).send({
            message: "Failed to add to favorites!",
            error: err,
          });
        }
      });
    } else {
      res.status(500).send({
        message: "User not found!",
        error: err,
      });
    }
  });
});

app.post("/user/favorites/remove", checkAuthentication, (req, res) => {
  User.findById(req.user._id, (err, user) => {
    if (!err) {
      user.favorites = user.favorites.filter((listingID) => {
        return listingID !== req.body.listingID;
      });
      user.save((err) => {
        if (!err) {
          res.status(200).send();
        } else {
          res.status(500).send({
            message: "Failed to remove from favorites!",
            error: err,
          });
        }
      });
    } else {
      res.status(500).send({
        message: "User not found!",
        error: err,
      });
    }
  });
});

app.post("/user/favorites/clear", checkAuthentication, (req, res) => {
  User.findById(req.user._id, (err, user) => {
    if (!err) {
      user.favorites = [];
      user.save((err) => {
        if (!err) {
          res.status(200).send({
            message: "Cleared favorites.",
          });
        } else {
          res.status(500).send({
            message: "Failed to clear favorites!",
            error: err,
          });
        }
      });
    } else {
      res.status(500).send({
        message: "User not found!",
        error: err,
      });
    }
  });
});

app.post("/listing/newListing", checkAuthentication, (req, res) => {
  const listing = new Listing({
    status: "available",
    "listing.title": req.body.listing.title,
    "listing.description": req.body.listing.description,
    "listing.listingOwnerId": req.user._id,
    "listing.createdAt": new Date(),
    condition: req.body.condition,
    year: req.body.year,
    make: req.body.make,
    model: req.body.model,
    trim: req.body.trim,
    "engine.capacity": req.body.engine.capacity,
    "engine.cylinders": req.body.engine.cylinders,
    "engine.horsepower": req.body.engine.horsepower,
    "engine.torque": req.body.engine.torque,
    miles: req.body.miles,
    "price.original": req.body.price.original,
    extColor: req.body.extColor,
    intColor: req.body.intColor,
    "location.city": req.body.location.city,
    "location.state": req.body.location.state,
    "location.zip": req.body.location.zip,
    pictures: {
      cover: req.body.pictures,
      otherPictures: req.body.otherPictures,
    },
  });

  listing.save((err) => {
    if (!err) {
      res.status(200).send({
        message: "Listing created successfully",
        listing: listing,
      });
    } else {
      res.status(500).send({
        message: "Failed to create listing!",
        error: err,
      });
    }
  });
});

app.get("/listing/getFavoritedListings", checkAuthentication, (req, res) => {
  //find user's favorites
  User.findById(req.user._id, (err, user) => {
    if (!err) {
      //find listings by id
      Listing.find({ _id: { $in: user.favorites } }, (err, foundListings) => {
        if (!err) {
          res.status(200).send({
            favorites: foundListings,
          });
        } else {
          res.status(500).send({
            message: "Failed to get listings!",
            error: err,
          });
        }
      });
    } else {
      res.status(500).send({
        message: "Failed to get listings!",
        error: err,
      });
    }
  });
});

///Public Routes///

app.get("/listing/getFeaturedListings", (req, res) => {
  //get 10 random listings
  Listing.aggregate([{ $sample: { size: 10 } }], (err, listings) => {
    if (!err) {
      res.status(200).send({
        listings: listings,
      });
    } else {
      res.status(500).send({
        message: "Failed to get listings!",
        error: err,
      });
    }
  });
});

//get listing by id
app.post("/listing/getListingById", (req, res) => {
  if (!req.body.listingID) {
    res.status(400).send({
      message: "Listing ID is required!",
    });
    return;
  }

  Listing.findById(req.body.listingID, (err, listing) => {
    if (!err) {
      res.status(200).send({
        listing: listing,
      });
    } else {
      res.status(500).send({
        message: "Failed to get listing!",
        error: err,
      });
    }
  });
});

// app.post("/listing/insertListing", (req, res) => {
//   Listing.insertMany(req.body.listings, (err, listings) => {
//     if (!err) {
//       res.status(200).send({
//         message: "Listings inserted successfully",
//       });
//     } else {
//       res.status(500).send({
//         message: "Failed to insert listings!",
//         error: err,
//       });
//     }
//   });
// });

app.listen(port, () => {
  console.log(`Server started running on port ${port}.`);
});
