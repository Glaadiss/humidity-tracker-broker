/* eslint-disable no-console */
const mosca = require("mosca");
const axios = require("axios");
const settings = {
  port: 1883
};
const TEMPERATURE = "Temperature";
const HUMIDITY = "Humidity";
const Axios = axios.create();
Axios.defaults.timeout = 5 * 60 * 1000;
function alert({ title, text, user }) {
  Axios.post(
    "https://gcm-http.googleapis.com/gcm/send",
    {
      to: user,
      notification: {
        title,
        text
      }
    },
    {
      headers: { Authorization: ` key=${global.process.env.FIREBASE_API_KEY}` }
    }
  );
}

let temperature = 0;
let humidity = 0;
let temperatureOut = 0;
let humidityOut = 0;
let ip = "157.158.160.207";

const handler = {
  get: function(obj, prop) {
    if (prop === "id") {
      const value = obj[prop];
      return value && value.replace && value.replace("publisher", "");
    }
    if (!prop || !prop.replace) return;
    const fixedProp = prop.replace("publisher", "");
    return obj[fixedProp];
  },
  set: function(obj, prop, value) {
    if (!prop || !prop.replace) return;
    const fixedProp = prop.replace("publisher", "");
    obj[fixedProp] = value;
    return true;
  }
};

const userHumidity = new Proxy({}, handler);

const server = new mosca.Server(settings);
weatherIntervalReader();

server.on("clientConnected", function(c) {
  const client = c && new Proxy(c, handler);
  console.log("client connected", client.id);
  sendToMobile(client);
});

server.on("clientDisconnected", function(c) {
  const client = c && new Proxy(c, handler);
  console.log("Client Disconnected:", client.id);
});

server.on("subscribed", (packet, c) => {
  const client = c && new Proxy(c, handler);
  sendToMobile(client);
});

server.on("published", function(packet, c) {
  const client = c && new Proxy(c, handler);
  const response = packet.payload.toString();
  if (client && client.id === "esp32") {
    handleSensorData(response);
  }
  if (isMobileClient(client)) {
    handleMobileSettings(client.id, response);
    logState();
  }
});

function handleMobileSettings(id, response) {
  try {
    const params = JSON.parse(response);
    if (params.updatedAt !== 0) return;
    const { temperatureMin, temperatureMax, humidityMin, humidityMax } = params;
    userHumidity[id] = {
      temperatureMin,
      temperatureMax,
      humidityMin,
      humidityMax,
      updatedAt: 0
    };
  } catch (error) {}
}

function handleSensorData(response) {
  try {
    const params = JSON.parse(response);
    if (params.ip) {
      ip = params.ip;
      return;
    }
    temperature = params.temperature;
    humidity = params.humidity;
    publishParams(params);
    notifyUsers();
  } catch (err) {
    console.log("Cant parse string " + response);
  }
}

function publishParams(response) {
  Object.keys(userHumidity).forEach(user => {
    console.log("PUBLISH USER", user, response);
    publishToClient(user);
  });
}

function logState() {
  console.log();
  console.log("_____STATE_____");
  console.log("temperature", temperature);
  console.log("humidity", humidity);
  console.log("userHumidity", userHumidity);
  console.log("IP", ip);
  console.log("_________");
  console.log();
}

function notifyUsers() {
  logState();
  Object.entries(userHumidity).forEach(([user, value]) => {
    const key = user.replace("mobile", "").replace("publisher", "");
    const timeElapsed = () => new Date() - value.updatedAt > 1000 * 60 * 10;
    if (timeElapsed()) {
      notify(
        key,
        TEMPERATURE,
        temperature > value.temperatureMax || temperature < value.temperatureMin
      );
    }
    if (timeElapsed()) {
      notify(
        key,
        HUMIDITY,
        humidity > value.humidityMax || humidity < value.humidityMin
      );
    }
  });
}

function notify(user, kind, cond) {
  if (cond) {
    userHumidity[user].updatedAt = new Date();
    alert({
      user,
      title: `${kind} is beyond boundaries!`,
      text: `${temperature} *C --- ${humidity} %`
    });
    console.log("NOTIFY USER", user, kind);
  }
}

function sendToMobile(client) {
  if (isMobileClient(client)) {
    userHumidity[client.id] = userHumidity[client.id] || {
      temperatureMax: 100,
      temperatureMin: -30,
      humidityMax: 100,
      humidityMin: 0
    };
    publishToClient(client.id);
  }
}

function publishToClient(id) {
  server.publish({
    topic: id,
    payload: JSON.stringify({
      temperature,
      humidity,
      temperatureOut,
      humidityOut,
      ...userHumidity[id]
    })
  });
}

function isMobileClient(client) {
  return client && client.id && client.id.startsWith("mobile");
}

function weatherIntervalReader() {
  getWeatherData().then(() => {
    console.log(humidityOut, temperatureOut);
  });
  setInterval(getWeatherData, 10 * 60 * 1000);
}

function getWeatherData() {
  if (!ip) {
    return Promise.resolve();
  }
  return Axios(getLatLon(ip))
    .then(({ data }) => {
      const [lat, lon] = data.split(",");
      return Axios(getWeather(lat, lon));
    })
    .then(({ data }) => {
      const main = data.data.current_condition[0];
      humidityOut = parseFloat(main.humidity);
      temperatureOut = parseFloat(main.temp_C);
    })
    .catch(err => {
      console.log(err);
    });
}

function getLatLon(ip) {
  return `https://ipapi.co/${ip}/latlong`;
}

function getWeather(lat, lon) {
  const api = global.process.env.WEATHER_API_KEY;
  return `http://api.worldweatheronline.com/premium/v1/weather.ashx?key=${api}&q=${lat},${lon}&num_of_days=1&tp=3&format=json`;
}
