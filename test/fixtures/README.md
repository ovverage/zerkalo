`pose.png` is the public MediaPipe Pose Landmarker example image from Google:
https://developers.google.com/static/mediapipe/images/solutions/examples/pose_detector.png

Used only by the local browser smoke test, not shipped in the application.
Source and attribution: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
Documentation content is licensed under CC BY 4.0 unless otherwise noted.

Run `npm run dev`, open `/test/browser.html`, and click “Проверить Heavy”.
The test uses a canvas video stream, without requesting camera access.
It checks local Heavy initialization, frame deduplication and detection of the
same reference image at the center, both edges and a 90° rotation. It does not
replace evaluation on real exercise recordings.
