# MediKiosk experiments

Another version of the MediKiosk student hackathon project. The idea was to collect basic intake information through a kiosk before a patient sees hospital staff. I worked on the programming side with AI help, alongside teammates working on the idea and hardware.

The original demo was incomplete. This repository contains a Flask version as well as copies of the Next.js and Python work. It is not a finished or clinically tested system.

For the main project overview, start with [MediKiosk in the Hackathon repo](https://github.com/AhmetFYaman/Hackathon).

## Finding the code

The files are nested under `Sirona-pj/Hackathon-pj/Project/Hackathon-Project/`:

- [medikiosk](Sirona-pj/Hackathon-pj/Project/Hackathon-Project/medikiosk): the Flask app, templates, and camera/sensor experiments.
- [kiosk-src](Sirona-pj/Hackathon-pj/Project/Hackathon-Project/kiosk-src): the Next.js version.
- [jetson_ai_server.py](Sirona-pj/Hackathon-pj/Project/Hackathon-Project/jetson_ai_server.py): experimental processing server.

The Ollama folders contain third-party reference code, not code written by our team. Their original documentation and licenses are left in place.

## Try the Flask version

Use Python 3 in a virtual environment. From the repository root:

```sh
cd Sirona-pj/Hackathon-pj/Project/Hackathon-Project/medikiosk
python -m pip install -r requirements.txt
python app.py --host 127.0.0.1
```

Open [localhost:5000](http://localhost:5000). Without hardware flags, the app uses mock sensor and camera data. The optional hardware libraries are listed in `requirements.txt`; the flags are documented at the top of `app.py`.

## Limitations

Mock values are demonstrations, not measurements. Real-device paths can also fall back to mock data, so check the logs. We did not finish or validate the full hardware setup during the hackathon.

Do not use this for diagnosis, triage, or treatment, and do not enter real patient information. Keep it as a local experiment with dummy data, not a public medical service.
