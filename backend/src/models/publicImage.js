'use strict';

const mongoose = require('mongoose');

/**
 * One publicly visible image, wherever it is hosted.
 *
 * Shared by every document that carries one, so a product photograph and a shop
 * logo are the same shape and `services/images.js` can read either without
 * asking which it was handed.
 *
 * Two providers, because of history rather than choice:
 *
 *   imgbb  `url` is the record. It cannot be derived from anything else we
 *          hold, so it is stored. `deleteUrl` is a page a human opens; there is
 *          no delete API, so removing the image here only detaches it.
 *   r2     `key` is the record and the URL is rebuilt at render time, so moving
 *          the bucket to a new domain does not orphan what is already saved.
 *
 * `id` is the handle in both cases: the ImgBB id, or the R2 key. A client
 * deleting an image names this one field and never has to know the difference.
 */
const publicImageSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['imgbb', 'r2'], default: 'imgbb' },
    /*
     * Not required, because product images written before this shape existed
     * carry a key and no id at all. Every reader falls back to the key, so an
     * old row keeps working and re-saving one does not fail validation.
     */
    id: { type: String },

    // Set for imgbb. Absent for r2, where the URL comes from the key.
    url: { type: String },
    thumbUrl: { type: String },
    deleteUrl: { type: String },

    // Set for r2. The object's location in the public bucket.
    key: { type: String },

    width: { type: Number },
    height: { type: Number },
    bytes: { type: Number },
  },
  { _id: false }
);

module.exports = publicImageSchema;
