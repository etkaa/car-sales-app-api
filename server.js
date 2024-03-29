require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");

const session = require("express-session");
const cookieParser = require("cookie-parser");
const MemoryStore = require("memorystore")(session);
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");

const multer = require("multer");
const upload = multer({ dest: "uploads/" });

const fs = require("fs");
const util = require("util");
//unlink the file after upload
const unlinkFile = util.promisify(fs.unlink);

const { uploadFiles, getFileStream, deleteObjects } = require("./s3");
const { resizeUploadedImage } = require("./imageResize");

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
    unique: true,
  },
  nickname: {
    type: String,
    required: true,
    unique: true,
  },
  about: {
    type: String,
  },
  profile: {
    profilePictureKey: String,
  },
  password: String,
  listings: [],
  favorites: [],
  imageKeysToSubmit: [],
  auth_method: String,
});

userSchema.plugin(passportLocalMongoose);

const User = mongoose.model("User", userSchema);

const listingSchema = new mongoose.Schema({
  isStock: String,
  status: String,
  listing: {
    title: String,
    description: String,
    listingOwnerId: String,
    listingOwnerNickname: String,
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
  transmission: String,
  miles: Number,
  price: Number,
  extColor: String,
  intColor: String,
  location: {
    city: String,
    state: String,
    zip: String,
  },
  pictures: [],
  statistics: {
    viewed: {
      type: Number,
      default: 0,
    },
    favorited: {
      type: Number,
      default: 0,
    },
    contacted: {
      type: Number,
      default: 0,
    },
    sold: Boolean,
    soldAt: Date,
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
    res.status(401).send("Unauthorized request, please sign in.");
    return;
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
  const nickname = req.body.username.split("@")[0];
  User.register(
    {
      fullName: req.body.fullName,
      username: req.body.username,
      nickname: nickname,
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
          Listing.updateOne(
            { _id: req.body.listingID },
            {
              $inc: { "statistics.favorited": 1 },
            },
            (err, docs) => {
              if (err) {
                res.status(500).send({
                  message: "Failed to increment favorites count!",
                  error: err,
                });
              }
            }
          );
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
          Listing.updateOne(
            { _id: req.body.listingID },
            {
              $inc: { "statistics.favorited": -1 },
            },
            (err, docs) => {
              if (err) {
                res.status(500).send({
                  message: "Failed to increment favorites count!",
                  error: err,
                });
              }
            }
          );
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
      //get all the listings that were favorited by the user and decrement the favorited count
      Listing.updateMany(
        { _id: { $in: user.favorites } },
        {
          $inc: { "statistics.favorited": -1 },
        },
        (err, docs) => {
          if (err) {
            res.status(500).send({
              message: "Failed to decrement favorites count!",
              error: err,
            });
          }
        }
      );
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

app.post("/listing/create", checkAuthentication, (req, res) => {
  const formData = req.body.formData;
  const imageKeys = req.body.imageKeys;

  const newListing = new Listing({
    status: "available",
    "listing.title": `${formData.year || ""} ${formData.make || ""} ${
      formData.model || ""
    }`,
    "listing.description": formData.description,
    condition: formData.condition,
    year: formData.year,
    make: formData.make,
    model: formData.model,
    trim: formData.trim,
    miles: formData.mileage,
    extColor: formData.extColor,
    intColor: formData.intColor,
    "engine.capacity": formData.engineCapacity,
    "engine.cylinders": formData.cylinders,
    "engine.horsepower": formData.horsepower,
    "engine.torque": formData.torque,
    transmission: formData.transmission,
    price: formData.price,
    "location.city": formData.city,
    "location.state": formData.state,
    "location.zip": formData.zip,
    pictures: imageKeys,
    "listing.createdAt": new Date(),
    "listing.listingOwnerId": req.user._id,
    "listing.listingOwnerNickname": req.user.nickname,
    "statistics.viewed": 0,
    "statistics.favorited": 0,
    "statistics.contacted": 0,
    "statistics.sold": false,
    "statistics.soldAt": null,
  });

  newListing.save((err, listing) => {
    if (!err) {
      //if no error, find the user, add the listing to their listings,
      //set their imageKeysToSubmit to empty array, and send a success message
      User.findById(req.user._id, (err, user) => {
        if (!err) {
          user.listings.push(listing._id);
          user.imageKeysToSubmit = [];
          user.save((err) => {
            if (!err) {
              res.status(200).send({
                message: "Listing created successfully",
                listingID: listing._id,
              });
            } else {
              res.status(500).send({
                message: "Failed to create listing!",
                error: err,
              });
            }
          });
        } else {
          res.status(500).send({
            message: "Failed to create listing!",
            error: err,
          });
        }
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
  Listing.aggregate([{ $sample: { size: 20 } }], (err, listings) => {
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

  Listing.updateOne(
    { _id: req.body.listingID },
    { $inc: { "statistics.viewed": 1 } },
    (err) => {
      if (err) {
        res.status(500).send({
          message: "Failed to update listing!",
          error: err,
        });
      }
    }
  );

  Listing.findById(req.body.listingID, (err, listing) => {
    if (!err) {
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

app.post(
  "/images/upload",
  checkAuthentication,
  upload.array("images"),
  async (req, res) => {
    var files = req.files; //get the files from the request
    var nickname = req.user.nickname;
    // console.log({ files }); // An array of the selected files
    if (!files || files.length === 0) {
      res.status(400).send({
        message: "Images are required!",
      });
      return;
    }
    var resizedFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const resizedImage = await resizeUploadedImage(file);
      resizedFiles.push(resizedImage);
    }
    // console.log({ resizedFiles });
    const result = await uploadFiles(resizedFiles, nickname);
    if (result) {
      files.map(async (file) => {
        console.log(file);
        await unlinkFile(file.path); //delete the original image
      });
      files.map(async (file) => {
        await unlinkFile(file.newPath); //delete the resized image
      });
      files = null; //memory cleanup
      resizedFiles = null; //memory cleanup
      res.status(200).send({
        message: "Image(s) uploaded successfully",
        image: result,
      });
    } else {
      console.log(result);
      res.status(500).send({
        message: "Failed to upload image(s)!",
      });
    }
  }
);

app.post("/images/delete", checkAuthentication, async (req, res) => {
  const imageKeysToDelete = req.body.imageKeysToDelete;
  if (!imageKeysToDelete || imageKeysToDelete.length === 0) {
    res.status(400).send({
      message: "Image keys are required!",
    });
    return;
  }
  const result = await deleteObjects(imageKeysToDelete);
  if (result) {
    res.status(200).send({
      message: "Image(s) deleted successfully",
    });
  } else {
    res.status(500).send({
      message: "Failed to delete image(s)!",
    });
  }
});

app.get("/images/getImage/:key", async (req, res) => {
  const key = req.params.key;
  const readStream = await getFileStream(key); ///PROBLEM IS HERE
  //check for errors before piping the stream to the response
  readStream
    .on("error", (err) => {
      res.status(500).send({
        message: "Request failed, please try again later.",
        error: err,
      });
    }) //if no errors, pipe the stream to the response
    .pipe(res);
});

app.get("/images/getImageKeys", checkAuthentication, async (req, res) => {
  User.findById(req.user._id, (err, user) => {
    if (!err) {
      res.status(200).send({
        imageKeys: user.imageKeysToSubmit,
      });
    } else {
      res.status(500).send({
        message: "Failed to get image keys!",
      });
    }
  });
});

app.post("/images/addImageKeys", checkAuthentication, async (req, res) => {
  const imageKeys = req.body.imageKeys;
  if (!imageKeys || imageKeys.length === 0) {
    res.status(400).send({
      message: "imageKeys are required!",
    });
    return;
  }
  User.findById(req.user._id, (err, user) => {
    if (!err) {
      imageKeys.forEach((key) => user.imageKeysToSubmit.push(key));
      user.save((err, result) => {
        if (!err) {
          res.status(200).send({
            result: result,
            message: "Unsubmitted keys added successfully",
          });
        } else {
          res.status(500).send({
            message: "Failed to add unsubmitted keys!",
          });
        }
      });
    } else {
      res.status(500).send({
        message: "Failed to save unsubmitted keys!",
      });
    }
  });
});

app.post("/images/removeImageKeys", checkAuthentication, async (req, res) => {
  const imageKeys = req.body.imageKeys;
  console.log(imageKeys);
  if (!imageKeys || imageKeys.length === 0) {
    res.status(400).send({
      message: "imageKeys are required!",
    });
    return;
  }
  User.findById(req.user._id, (err, user) => {
    if (!err) {
      user.imageKeysToSubmit = user.imageKeysToSubmit.filter(
        (key) => !imageKeys.includes(key)
      );
      user.save((err, result) => {
        if (!err) {
          res.status(200).send({
            result: result,
            message: "Unsubmitted keys deleted successfully",
          });
        } else {
          res.status(500).send({
            message: "Failed to delete unsubmitted keys!",
          });
        }
      });
    } else {
      res.status(500).send({
        message: "Failed to save unsubmitted keys!",
      });
    }
  });
});

app.get("/user/getUserListings", checkAuthentication, (req, res) => {
  Listing.find(
    { "listing.listingOwnerId": req.user._id },
    (err, userListings) => {
      if (!err) {
        res.status(200).send({
          userListings: userListings,
        });
      } else {
        res.status(500).send({
          message: "Failed to get listings!",
        });
      }
    }
  );
});

app.post("/listing/delete", checkAuthentication, (req, res) => {
  const userId = req.user._id;
  const listingId = req.body.listingId;

  Listing.findById(listingId, async (err, listing) => {
    if (listing.listing.listingOwnerId != userId) {
      res.status(401).send({
        message: "Unauthorized to delete this listing!",
      });
      return;
    }
    const imageKeys = listing.pictures;

    deleteObjects(imageKeys)
      .then((data) => {
        Listing.findByIdAndDelete(listingId, (err) => {
          if (!err) {
            res.status(200).send({
              message: "Listing deleted successfully",
            });
          } else {
            res.status(500).send({
              message: "Failed to delete listing!",
            });
          }
        });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({
          message: "Failed to delete listing!",
        });
      });
  });
});

app.put("/user/updateProfileFields", checkAuthentication, async (req, res) => {
  const userId = req.user._id;
  const { fullName, nickname, about } = req.body.formData;

  try {
    // Get the current user profile from the database
    const user = await User.findById(userId);

    // Update only the fields that have changed
    if (fullName && fullName !== user.fullName) {
      user.fullName = fullName;
    }
    if (nickname && nickname !== user.nickname) {
      // Check if the new nickname is unique before updating it
      const existingUser = await User.findOne({ nickname });
      if (existingUser && existingUser._id.toString() !== userId) {
        return res.status(400).send({
          message: "Nickname is not unique!",
          errCode: "nicknameNotUnique",
        });
      }
      user.nickname = nickname;
    }
    if (about && about !== user.about) {
      user.about = about;
    }

    // Save the updated user profile to the database
    const updatedUser = await user.save();

    res.status(200).send({
      message: "Profile updated successfully",
      updatedUser,
    });
  } catch (err) {
    res.status(500).send({
      message: "Failed to update profile",
    });
  }
});

app.put("/user/updateProfileImage", checkAuthentication, async (req, res) => {
  const userId = req.user._id;
  // we will receive the s3 key of the new profile picture, just save it into the database
  const newProfilePictureKey = req.body.imageKey;

  try {
    // Get the current user profile from the database
    User.findById(userId, (err, user) => {
      if (!err) {
        //delete the existing profile picture from s3
        if (user?.profile?.profilePictureKey) {
          deleteObjects([user.profile.profilePictureKey]);
        }
        //update the profile picture key in the database
        // if field doesn't exist, create it
        if (!user.profile) {
          user.profile = {};
        }
        // set the new profile picture key
        user.profile.profilePictureKey = newProfilePictureKey;
        // save the user changes
        user.save((err, result) => {
          if (!err) {
            res.status(200).send({
              message: "Profile picture updated successfully",
              result: result,
            });
          } else {
            res.status(500).send({
              message: "Error when saving user!",
            });
          }
        });
      } else {
        res.status(500).send({
          message: "Cant find the user!",
        });
      }
    });
  } catch (err) {
    res.status(500).send({
      message: "Failed to update profile picture!",
    });
  }
});

app.listen(port, () => {
  console.log(`Server started running on port ${port}.`);
});
