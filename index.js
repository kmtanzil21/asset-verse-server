const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;


const admin = require("firebase-admin");

const serviceAccount = require("./asset-verse-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    // FIX: Extract email from the decoded object
    // Firebase stores the email in 'decoded.email'
    req.decoded_email = decoded.email;

    next();
  } catch (err) {
    console.error("Token Verification Error:", err);
    return res.status(401).send({ message: 'unauthorized access' });
  }
};
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fhoootj.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const db = client.db('assetVerse_db');

    const assetsCollection = db.collection('assets');
    const packagesCollection = db.collection('packages');
    const usersCollection = db.collection('users');
    const requestsCollection = db.collection('requests');
    const paymentsCollection = db.collection('payments');
    const employeeCollection = db.collection('employee');

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== 'hr') {
        return res.status(403).send({ message: "Forbidden Access" });

      }
      next();

    }

    app.get('/packages', async (req, res) => {
      const result = await packagesCollection.find().toArray();
      res.send(result);
    });


    app.post('/assets', verifyFBToken, async (req, res) => {
      const asset = req.body;
      const email = asset.hrEmail;
      try {
        const user = await usersCollection.findOne({ email: email });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        if (user.role !== 'hr') {
          return res.status(403).send({ message: "Access Denied: Only HR managers can add assets." });
        }
        const result = await assetsCollection.insertOne(asset);
        res.send(result);
      } catch (error) {
        console.log("Error adding asset:", error);
        res.status(500).send({ message: "Internal server Error" });
      }
    });


    app.post('/users', verifyFBToken, async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'User already exists', insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });




    app.get('/users/role/:email', verifyFBToken, async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email: email });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send({ role: user.role });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Error retrieving role" });
      }
    });

    app.get('/users/:email/role', verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || 'user' })

    })

    app.patch('/users/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;

      // Check if the id is a valid ObjectId string
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }

      const query = { _id: new ObjectId(id) };  // Create the ObjectId for the query
      const updatedData = req.body;
      console.log(updatedData, query); // Use the data from the request body
      const updatedDoc = {
        $set: updatedData
      };



      try {
        const result = await usersCollection.updateOne(query, updatedDoc);

        // Check if the modification was successful
        if (result.modifiedCount > 0) {
          res.send({ message: "Profile updated successfully", modifiedCount: result.modifiedCount });
        } else {
          res.status(400).send({ message: "No changes were made to the profile" });
        }
      } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).send({ message: "Failed to update profile", error });
      }
    });



    app.get('/all-assets', async (req, res) => {
      const { search, page = 1, limit = 10 } = req.query; // Default to page 1, limit 10
      const skip = (parseInt(page) - 1) * parseInt(limit);

      let query = {};
      if (search) {
        query.productName = { $regex: search, $options: 'i' };
      }

      try {
        // 1. Get the paginated data
        const assets = await assetsCollection.find(query)
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        // 2. Get total count for pagination controls
        const totalCount = await assetsCollection.countDocuments(query);

        res.send({
          assets,
          totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit))
        });
      } catch (error) {
        res.status(500).send({ message: "Error fetching assets" });
      }
    });

    app.delete('/assets/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await assetsCollection.deleteOne(query);
      res.send(result);
    })

    const { ObjectId } = require('mongodb');  // Ensure ObjectId is imported




    app.patch('/assets/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: updatedData,
      };
      const result = await assetsCollection.updateOne(query, updatedDoc);
      res.send(result);

    })

    app.get('/my-assets', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      console.log(email);
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }
      const query = { hrEmail: email };
      const result = await assetsCollection.find(query).toArray();
      res.send(result);
    });


    //Request Related 

    app.get('/requests', verifyFBToken, async (req, res) => {
      const { hrEmail } = req.query;

      try {
        const requests = await requestsCollection.find({ hrEmail }).toArray();
        res.send(requests);
      } catch (error) {
        console.log("Error fetching requests:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get('/my-hr', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = { email, status: 'approved' };
      const results = await requestsCollection.find(query).toArray();
      res.send(results);

    });

    app.get('/colleagues', verifyFBToken, async (req, res) => {
      const hrEmail = req.query.email;
      const query = { hrEmail: hrEmail, status: 'approved' };
      const results = await requestsCollection.find(query).toArray();
      res.send(results);
    });

    app.get('/requests/employee', verifyFBToken, async (req, res) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).send({ message: "Email required" });
      }

      const query = { email, status: 'approved' };
      const requests = await requestsCollection.find(query).toArray();
      res.send(requests);
    });


    // app.get('/requests/approved', async (req, res) => {
    //   const { hrEmail, status } = req.query;

    //   const query = { hrEmail };

    //   // If status is provided in the query, add it to the filter
    //   if (status) {
    //     query.status = status;
    //   }

    //   try {
    //     const requests = await requestsCollection.find(query).toArray();
    //     res.send(requests);
    //   } catch (error) {
    //     console.log("Error fetching requests:", error);
    //     res.status(500).send({ message: "Internal server error" });
    //   }
    // });


    app.get('/requests/approved', verifyFBToken, async (req, res) => {
      const { hrEmail, status } = req.query;
      const query = { hrEmail, status: 'approved' };

      try {
        const requests = await requestsCollection.find(query).toArray(); // Apply the status filter
        res.send(requests);
      } catch (error) {
        console.log("Error fetching approved requests:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get('/hr/:hrEmail/approved-employees', verifyFBToken, async (req, res) => {
      const { hrEmail } = req.params;

      try {
        const approvedRequests = await requestsCollection.find({ hrEmail, status: 'approved' }).toArray();
        const uniqueEmails = [...new Set(approvedRequests.map(request => request.email))];
        const employees = await usersCollection.find({ email: { $in: uniqueEmails } }).toArray();
        const hrDetails = await usersCollection.findOne({ email: hrEmail });
        if (!hrDetails) {
          return res.status(404).send({ message: "HR not found" });
        }
        const companyName = hrDetails.companyName || "Unknown Company";  // Default to "Unknown Company" if not found
        const employeesWithAssetNames = employees.map(employee => {
          const employeeRequest = approvedRequests.find(req => req.email === employee.email);
          const asset = employeeRequest ? employeeRequest.assetName : "Unknown Asset";  // Default to "Unknown Asset" if not found
          return { ...employee, assetName: asset };
        });

        const response = {
          companyName,
          hrName: hrDetails.name,  // HR name
          hrEmail: hrDetails.email,  // HR email
          employees: employeesWithAssetNames
        };
        res.status(200).send(response);
      } catch (error) {
        console.error("Error fetching approved employees:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });





    // POST route for direct HR assignment
    app.post('/assign-asset-direct', verifyFBToken, async (req, res) => {
      const assignment = req.body;
      const { assetId } = assignment;

      try {
        // 1. Verify asset stock before assigning
        const asset = await assetsCollection.findOne({ _id: new ObjectId(assetId) });

        if (!asset) {
          return res.status(404).send({ message: "Asset not found" });
        }

        if (parseInt(asset.productQuantity) <= 0) {
          return res.status(400).send({ message: "Asset is out of stock" });
        }

        // 2. Insert the pre-approved request into the database
        const result = await requestsCollection.insertOne(assignment);

        // 3. Automatically decrement the asset quantity by 1
        await assetsCollection.updateOne(
          { _id: new ObjectId(assetId) },
          { $inc: { productQuantity: -1 } }
        );

        res.status(201).send(result);
      } catch (error) {
        console.error("Error in direct assignment:", error);
        res.status(500).send({ message: "Internal server error during assignment" });
      }
    });








    app.post('/request-asset', verifyFBToken, async (req, res) => {
      try {
        const { assetId, email, name, assetName } = req.body;

        // security: email must match token
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        if (!assetId || !email) {
          return res.status(400).send({ message: "assetId and email are required" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });

        const asset = await assetsCollection.findOne({ _id: new ObjectId(assetId) });
        if (!asset) return res.status(404).send({ message: "Asset not found" });

        // Optional stock check (you can remove if you want)
        if (parseInt(asset.productQuantity) <= 0) {
          return res.status(400).send({ message: "Asset is out of stock" });
        }

        const request = {
          assetId,
          email,
          name: name || user.name || "",
          assetName: assetName || asset.productName || "",
          hrEmail: asset.hrEmail,
          status: "pending",
          requestedAt: new Date(),
        };

        const result = await requestsCollection.insertOne(request);
        res.status(201).send(result);
      } catch (error) {
        console.log("Error requesting asset:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });


    app.patch('/requests/:id/approve', verifyFBToken, async (req, res) => {
      const { id } = req.params;

      try {
        // 1. Fetch request details first to get HR and Employee info
        const requestData = await requestsCollection.findOne({ _id: new ObjectId(id) });
        if (!requestData) {
          return res.status(404).send({ message: 'Request not found' });
        }

        // 2. Check if the employee is already in the company
        const existingEmployee = await employeeCollection.findOne({ email: requestData.email });

        // 3. LIMIT CHECK: Only if the employee is NEW to the company
        if (!existingEmployee) {
          // Fetch HR data to get their package limit
          const hr = await usersCollection.findOne({ email: requestData.hrEmail });

          // Count current employees assigned to this HR
          const currentEmployeeCount = await employeeCollection.countDocuments({
            hrEmail: requestData.hrEmail
          });

          // If limit is reached, block the approval
          if (currentEmployeeCount >= hr.packageLimit) {
            return res.status(403).send({
              message: "Employee limit reached. Please upgrade your package to add more members."
            });
          }

          // If within limit, add the employee to the collection
          await employeeCollection.insertOne({
            name: requestData.name,
            email: requestData.email,
            hrEmail: requestData.hrEmail,
            addedAt: new Date().toISOString()
          });
        }

        // 4. Proceed with Approval (Update Request Status)
        const updateResult = await requestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: 'approved', approvedAt: new Date().toISOString() } }
        );

        // 5. Reduce Asset Inventory by 1
        await assetsCollection.updateOne(
          { _id: new ObjectId(requestData.assetId) },
          { $inc: { productQuantity: -1 } }
        );

        res.status(200).send({
          message: "Request approved and inventory updated.",
          modifiedCount: updateResult.modifiedCount
        });

      } catch (error) {
        console.error("Error Approving Request:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    //     app.patch('/requests/:id/approve', verifyFBToken, async (req, res) => {
    //   const { id } = req.params;

    //   try {
    //     // 1. Update the request status to 'approved'
    //     const updateResult = await requestsCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       { $set: { status: 'approved', approvedAt: new Date().toISOString() } }
    //     );

    //     if (updateResult.matchedCount === 0) {
    //       return res.status(404).send({ message: 'Request not found' });
    //     }

    //     // 2. Fetch the full request details to get assetId and employee info
    //     const requestData = await requestsCollection.findOne({ _id: new ObjectId(id) });

    //     // 3. REDUCE ASSET QUANTITY BY 1
    //     // We use $inc with -1 to decrement the quantity
    //     const assetUpdate = await assetsCollection.updateOne(
    //       { _id: new ObjectId(requestData.assetId) },
    //       { $inc: { productQuantity: -1 } }
    //     );

    //     // 4. Synchronize Employee Collection
    //     const existingEmployee = await employeeCollection.findOne({ email: requestData.email });

    //     if (!existingEmployee) {
    //       await employeeCollection.insertOne({
    //         name: requestData.name,
    //         email: requestData.email,
    //         hrEmail: requestData.hrEmail,
    //         addedAt: new Date().toISOString()
    //       });
    //     }

    //     res.status(200).send({
    //       message: "Request Approved, Quantity Reduced, and Employee Synchronized",
    //       modifiedCount: updateResult.modifiedCount,
    //       assetUpdated: assetUpdate.modifiedCount > 0
    //     });

    //   } catch (error) {
    //     console.error("Error Approving Request:", error);
    //     res.status(500).send({ message: "Internal Server Error" });
    //   }
    // });


    // app.patch('/requests/:id/approve', verifyFBToken, async (req, res) => {
    //   const { id } = req.params;

    //   try {
    //     const updateResult = await requestsCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       { $set: { status: 'approved', approvedAt: new Date().toISOString() } }
    //     );

    //     if (updateResult.matchedCount === 0) {
    //       return res.status(404).send({ message: 'Request not found' });
    //     }
    //     const requestData = await requestsCollection.findOne({ _id: new ObjectId(id) });
    //     const existingEmployee = await employeeCollection.findOne({ email: requestData.email });

    //     if (!existingEmployee) {
    //       await employeeCollection.insertOne({
    //         name: requestData.name,
    //         email: requestData.email,
    //         hrEmail: requestData.hrEmail,
    //         addedAt: new Date().toISOString()
    //       });
    //     }

    //     res.status(200).send({
    //       message: "Request Approved and Employee Synchronized",
    //       modifiedCount: updateResult.modifiedCount
    //     });

    //   } catch (error) {
    //     console.error("Error Approving Request:", error);
    //     res.status(500).send({ message: "Internal Server Error" });
    //   }
    // });

    app.get('/employee/:email', verifyFBToken, async (req, res) => {
      const hrEmail = req.params.email;
      const result = await employeeCollection.find({ hrEmail: hrEmail }).toArray();
      res.send(result);
    });

    // app.delete('/employee-delete/:email', verifyFBToken, async (req, res) => {
    //   const hrEmail = req.query.hrEmail;
    //   const email = req.params.email;
    //   const query = { hrEmail: hrEmail, email: email };
    //   const result = await employeeCollection.deleteOne(query);
    //   res.send(result);
    // });


    app.delete('/employee-delete/:email', verifyFBToken, async (req, res) => {
    const hrEmail = req.query.hrEmail;
    const email = req.params.email;

    try {
        // 1. Find all 'approved' requests for this employee to identify assets to return
        // This ensures only assets currently held by the employee are added back to stock
        const approvedRequests = await requestsCollection.find({ 
            email: email, 
            hrEmail: hrEmail, 
            status: 'approved' 
        }).toArray();

        // 2. Increase product quantity for each approved asset being returned
        // We iterate through the approved requests and use $inc to add 1 to the stock
        for (const request of approvedRequests) {
            await assetsCollection.updateOne(
                { _id: new ObjectId(request.assetId) },
                { $inc: { productQuantity: 1 } }
            );
        }

        // 3. Update the status of ALL requests (pending or approved) for this employee to 'rejected'
        await requestsCollection.updateMany(
            { email: email, hrEmail: hrEmail },
            { $set: { status: 'rejected' } }
        );

        // 4. Finally, delete the employee from the company's employee list
        const query = { hrEmail: hrEmail, email: email };
        const result = await employeeCollection.deleteOne(query);
        
        res.send(result);
    } catch (error) {
        console.error("Error removing employee and returning assets:", error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.name,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          packageId: paymentInfo.packageId,
          userEmail: paymentInfo.email,
          employeeLimit: paymentInfo.employeeLimit,
        },
        customer_email: paymentInfo.email,
        mode: 'payment',
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    app.patch('/payment-success', async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId) return res.status(400).send({ error: "No session ID" });

        // 1. Check if this payment was ALREADY processed
        // We use the sessionId (from Stripe) as a unique identifier
        const existingPayment = await paymentsCollection.findOne({ sessionId: sessionId });

        if (existingPayment) {
          return res.send({ success: true, message: "Already processed", alreadyDone: true });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === 'paid') {
          const email = session.metadata.userEmail;
          const newLimit = parseInt(session.metadata.employeeLimit);

          // 2. Update User Limit
          const query = { email: email };
          const update = { $set: { employeeLimit: newLimit } };
          const userUpdateResult = await usersCollection.updateOne(query, update);

          // 3. Create Payment Record (Include the sessionId this time!)
          const payment = {
            sessionId: sessionId, // Important: Store this to prevent duplicates!
            amount: session.amount_total / 100,
            currency: session.currency,
            customerEmail: email,
            packageID: session.metadata.packageId,
            paidAt: new Date()
          };

          const paymentInsertResult = await paymentsCollection.insertOne(payment);

          return res.send({
            success: true,
            userUpdateResult,
            paymentInsertResult
          });
        }

        res.status(400).send({ success: false, message: "Payment not verified" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: error.message });
      }
    });



    app.patch('/approve-request/:requestId', verifyFBToken, async (req, res) => {
      const { requestId } = req.params;
      const { status } = req.body;
      if (status !== 'approved' && status !== 'denied') {
        return res.status(400).send({ message: "Invalid Status" });
      }

      try {
        const result = await requestsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          {
            $set: { status }
          }

        );
        res.send(result);
      }
      catch (error) {
        console.log("Error approving request:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    })


    app.get('/payment-history/:email', async (req, res) => {
      const email = req.params.email;

      const result = await paymentsCollection.aggregate([
        { $match: { customerEmail: email } },
        { $sort: { paidAt: -1 } },
        {
          $group: {
            _id: "$packageID",
            latestPayment: { $first: "$$ROOT" }
          }
        },
        { $replaceRoot: { newRoot: "$latestPayment" } }
      ]).toArray();

      res.send(result);
    });


    // app.post('/create-checkout-session', async (req, res) => {
    //     const paymentInfo = req.body;
    //     const amount = parseInt(paymentInfo.price) * 100; // Convert to cents

    //     // Create the Stripe session
    //     const session = await stripe.checkout.sessions.create({
    //         line_items: [
    //             {
    //                 price_data: {
    //                     currency: 'USD',
    //                     unit_amount: amount,
    //                     product_data: {
    //                         name: paymentInfo.name,
    //                     },
    //                 },
    //                 quantity: 1,
    //             },
    //         ],
    //         customer_email: paymentInfo.email,
    //         mode: 'payment',
    //         success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`, // Use the correct environment variable for success URL
    //         cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`, // Redirect on cancel
    //     });

    //     console.log(session);
    //     res.send({ url: session.url }); // Send the session URL to frontend
    // });


    app.patch('/update-profile', verifyFBToken, async (req, res) => {
      const userEmail = req.decoded_email; // From your middleware
      const updatedData = req.body;

      // Remove email from body if present to keep it read-only
      delete updatedData.email;

      const query = { email: userEmail };
      const updatedDoc = {
        $set: updatedData
      };

      const result = await usersCollection.updateOne(query, updatedDoc);
      res.send(result);
    });



    app.get('/asset-distribution', verifyFBToken, async (req, res) => {
      const hrEmail = req.query.email;
      const decodedEmail = req.decoded_email;

      // Identity & Role Check
      if (hrEmail !== decodedEmail) return res.status(403).send({ message: "Forbidden" });
      const user = await usersCollection.findOne({ email: hrEmail });
      if (!user || user.role !== 'hr') return res.status(403).send({ message: "HR Access Required" });

      const result = await assetsCollection.aggregate([
        { $match: { hrEmail: hrEmail } },
        { $group: { _id: "$productType", value: { $sum: 1 } } },
        { $project: { name: "$_id", value: 1, _id: 0 } }
      ]).toArray();
      res.send(result);
    });

    // 2. Bar Chart: Top 5 most requested assets
    app.get('/top-requests', verifyFBToken, async (req, res) => {
      const hrEmail = req.query.email;
      const decodedEmail = req.decoded_email;

      if (hrEmail !== decodedEmail) return res.status(403).send({ message: "Forbidden" });
      const user = await usersCollection.findOne({ email: hrEmail });
      if (!user || user.role !== 'hr') return res.status(403).send({ message: "HR Access Required" });

      const result = await requestsCollection.aggregate([
        { $match: { hrEmail: hrEmail } },
        { $group: { _id: "$assetName", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $project: { name: "$_id", count: 1, _id: 0 } }
      ]).toArray();
      res.send(result);
    });




    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('assetVerse is Running');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
