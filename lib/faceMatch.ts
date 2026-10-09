// Compares a face-snapshot photo taken during an exam against the student's own reference
// photo (set in Settings), so a mismatch can be auto-flagged as a face_mismatch cheating
// incident - see monitoring.service.ts. Self-hosted (no paid API): @vladmandic/face-api on
// @tensorflow/tfjs-node, running entirely on this server. Needs Node <=22 - see Dockerfile.

import * as tf from '@tensorflow/tfjs-node';
import * as faceapi from '@vladmandic/face-api';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/@vladmandic/face-api/model');

// face-api.js convention: a euclidean distance between descriptors below this is "the same person"
const MATCH_THRESHOLD = 0.6;

let modelsLoaded: Promise<void> | null = null;
const ensureModelsLoaded = () => {
  if (!modelsLoaded) {
    modelsLoaded = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR),
    ]).then(() => undefined);
  };
  return modelsLoaded;
};

const descriptorFor = async (imageBytes: Buffer): Promise<Float32Array | null> => {
  const tensor = tf.node.decodeImage(imageBytes, 3) as tf.Tensor3D;
  try {
    const result = await faceapi
      .detectSingleFace(tensor, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    return result?.descriptor ?? null;
  } finally {
    tensor.dispose();
  };
};

export type FaceMatchResult =
  | { outcome: 'matched' | 'mismatched'; distance: number }
  | { outcome: 'no_face_in_photo' | 'no_face_in_reference' };

export const compareFaces = async (photoBytes: Buffer, referenceBytes: Buffer): Promise<FaceMatchResult> => {
  await ensureModelsLoaded();
  const [photoDescriptor, referenceDescriptor] = await Promise.all([descriptorFor(photoBytes), descriptorFor(referenceBytes)]);

  if (!photoDescriptor) return { outcome: 'no_face_in_photo' };
  if (!referenceDescriptor) return { outcome: 'no_face_in_reference' };

  const distance = faceapi.euclideanDistance(photoDescriptor, referenceDescriptor);
  return { outcome: distance < MATCH_THRESHOLD ? 'matched' : 'mismatched', distance };
};
