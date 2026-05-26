-- Migration 019: Increase description max length from 75 to 200 characters

CREATE OR REPLACE FUNCTION check_description_length()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.description IS NOT NULL AND char_length(NEW.description) > 200 THEN
    RAISE EXCEPTION 'Description must not exceed 200 characters (got %)', char_length(NEW.description);
  END IF;
  RETURN NEW;
END;
$$;
