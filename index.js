const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// MongoDB URI
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

    app.get('/packages', async (req, res) => {
      const result = await packagesCollection.find().toArray();
      res.send(result);
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'User already exists', insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.post('/assets', async (req, res) => {
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



    app.get('/users/role/:email', async (req, res) => {
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


    app.get('/all-assets', async (req, res) => {
      const { search } = req.query;
      let query = {};
      if (search) {
        query.productName = { $regex: search, $options: 'i' };
      }
      const result = await assetsCollection.find(query).toArray();
      res.send(result);
    });

    app.delete('/assets/:id', async(req,res)=>{
      const id=req.params.id;
      const query={_id: new ObjectId(id)};
      const result= await assetsCollection.deleteOne(query);
      res.send(result);
    })

    app.get('/my-assets', async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }
      const query = { hrEmail: email };
      const result = await assetsCollection.find(query).toArray();
      res.send(result);
    });


    //Request Related 

    app.get('/requests', async (req, res) => {
      const { hrEmail } = req.query;

      try {
        const requests = await requestsCollection.find({ hrEmail }).toArray();
        res.send(requests);
      } catch (error) {
        console.log("Error fetching requests:", error);
        res.status(500).send({ message: "Internal server error" });
      }
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


    app.get('/requests/approved', async (req, res) => {
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

    app.get('/hr/:hrEmail/approved-employees', async (req, res) => {
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
    app.post('/assign-asset-direct', async (req, res) => {
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








    app.patch('/requests/:id/approve', async (req, res) => {
      const { id } = req.params;
      try {
        const updatedRequest = await requestsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { status: 'approved' }
          }
        )

        if (updatedRequest.modifiedCount > 0) {
          res.status(200).send({ message: "Request Approved Successfully" });
        }
        else {
          res.status(404).send({ message: 'Request not found' });
        }

      }
      catch (error) {
        console.error("Error Updating Request", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    })


   app.post('/create-checkout-session', async (req, res) => {
    const paymentInfo = req.body;
    const amount = parseInt(paymentInfo.price) * 100;

    // Create the Stripe session
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
        customer_email: paymentInfo.email,
        mode: 'payment',
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`, // Correct URL
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`, // Correct URL
    });

    console.log('Redirecting to:', `${process.env.SITE_DOMAIN}/dashboard/payment-success`); // Log for debugging
    res.send({ url: session.url }); // Send the session URL to frontend
});



    app.patch('/approve-request/:requestId', async (req, res) => {
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


app.post('/create-checkout-session', async (req, res) => {
    const paymentInfo = req.body;
    const amount = parseInt(paymentInfo.price) * 100; // Convert to cents

    // Create the Stripe session
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
        customer_email: paymentInfo.email,
        mode: 'payment',
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`, // Use the correct environment variable for success URL
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`, // Redirect on cancel
    });

    console.log(session);
    res.send({ url: session.url }); // Send the session URL to frontend
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
