# Simplification of Prefix Configuration

* The use of globs as keys in section-prefixes.config.yaml has proved over-complicated.
* Instead, each key should be just a directory name ending with "/" or a file name ending with ".md".
* If the key is a directory name, the associated prefix applies for every file in that directory not covered
  by a more specific entries.
* "More specific" should be determined by the code, not by any dependence on the order of the keys in the YAML.
  In other words, prefixes should be determined from the longest key that matches a file's path.
* Paths are relative to the folder containing the .specquer folder and will need normalizing to remove any leading "./".
* No data migration is needed. I have already updated Specquer's own config file (double check it). Specquer has
  not been used elsewhere yet.
* Update the specification documents to match this change.